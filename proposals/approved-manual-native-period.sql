-- IMPLEMENTATION WORKING PROPOSAL; NOT A CANONICAL MIGRATION.
-- Qualified in the exact retained owned SQL component; no production invocation.
-- Source301/canary/restore enrollment remains a separate single-writer migration.
begin;
-- Component SOURCE302_NATIVE_ADMISSION_DRAFT_20261030.sql
-- WORKING successor draft. Owned fixture only until canonical adoption.
-- No production invocation, source regeneration, or role expansion.
set local lock_timeout='5s';
set local statement_timeout='120s';

create or replace function public.static_weekly_manual_exception_summary(p_exceptions jsonb)
returns jsonb language sql immutable set search_path=pg_catalog,public as $fn$
 select coalesce(jsonb_agg(jsonb_build_object('id',e->'id','type',e->'type','serviceDate',e->'serviceDate',
  'payloadDigest',coalesce(e->'payloadDigest',to_jsonb(public.static_weekly_digest_text(format('{"slotId":"%s"}',e#>>'{payload,slotId}'))))) order by n),'[]')
 from jsonb_array_elements(p_exceptions) with ordinality x(e,n)
$fn$;
revoke all on function public.static_weekly_manual_exception_summary(jsonb) from public,anon,authenticated,service_role,
 static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;

create or replace function public.static_weekly_manual_period_basis(p_manager uuid,p_publication uuid,p_date date,p_revision bigint,p_operation uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare source jsonb;normal_source jsonb;original_source jsonb;exceptions jsonb;original_exceptions jsonb;summary jsonb;
 ctx jsonb;actor jsonb;frame date;version uuid;sid uuid;entry record;prior record;prior_json jsonb:=null;
 day_bases jsonb:='[]';body jsonb;original_revision bigint:=p_revision;
begin
 perform public.static_weekly_v3_assert_control_plane();actor:=public.static_weekly_v3_manager_actor(p_manager);
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 if p_revision is null or p_revision not between 0 and 9007199254740991
  or p_revision is distinct from (select current_revision from public.static_weekly_schedule_control where singleton)
  or p_date is null or not isfinite(p_date) then raise exception using errcode='40001',message='Exact current manual period revision and date required';end if;
 source:=public.static_weekly_v3_read_publication_source(p_publication,p_date);
 if source#>>'{compiler_input,version,manualGroupRatingAuthority,manifestSha256}' is distinct from 'fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f'
  or source->>'publication_id' is distinct from p_publication::text then raise exception 'Exact approved manual publication required';end if;
 frame:=public.static_weekly_source_window_start(source->'compiler_input',p_date);
 source:=public.static_weekly_v3_read_publication_source(p_publication,frame);
 version:=(source->>'version_id')::uuid;
 if public.static_weekly_effective_version(frame) is distinct from version
  or public.static_weekly_effective_version(frame+6) is distinct from version then raise exception 'Manual period crosses an effective publication';end if;
 select authority_source_id into strict sid from public.weekly_schedule_versions where version_id=version;
 select c.template_id,c.owner_config,c.catalog_entry_digest,c.template_json,c.binding_json,c.approval_evidence into strict entry
 from public.static_weekly_approved_initial_baselines b join public.static_weekly_approved_template_catalog c using(template_id)
 where b.source_id=sid and not exists(select 1 from public.static_weekly_approved_template_retirements r where r.template_id=c.template_id);
 if entry.catalog_entry_digest is distinct from public.static_weekly_digest_jsonb(jsonb_build_object(
  'template',entry.template_json,'binding',entry.binding_json,'ownerConfig',entry.owner_config,'approvalEvidence',entry.approval_evidence))
  or entry.owner_config->>'approvedManualDataDigest' is distinct from 'eeff371f1510c6e4a079bde3ba17136dc10f64b100c7562d9b139fd14805a1c8'
 then raise exception 'The admitted manual policy/configuration changed';end if;
 normal_source:=jsonb_set(jsonb_set(source->'compiler_input','{serviceDate}',to_jsonb(frame::text),true),'{exceptions}','[]'::jsonb,true);
 if p_operation is not null then
  ctx:=public.static_weekly_pending_context(p_operation,p_manager);
  original_revision:=(ctx#>>'{originalCommand,expectedRevision}')::bigint;
  if frame>(ctx#>>'{originalCommand,semanticBody,endDate}')::date
   or frame+6<(ctx#>>'{originalCommand,semanticBody,startDate}')::date then raise exception 'Manual frame is outside the original command';end if;
  original_exceptions:=public.static_weekly_pending_original_exception_set(p_publication,frame,p_operation);
  exceptions:=public.static_weekly_pending_exception_set(p_operation,p_publication,frame,null);
  summary:=public.static_weekly_pending_summary(p_operation,p_publication,frame,null);
  original_source:=jsonb_set(jsonb_set(source,'{authority_revision}',to_jsonb(original_revision),false),'{exceptions}',original_exceptions,false);
 else
  exceptions:=public.static_weekly_compiler_exception_set(p_publication,frame);original_exceptions:=exceptions;
  summary:=public.static_weekly_accepted_exception_set(p_publication,frame);original_source:=source;
 end if;
 select p.projection_id,p.publication_id,p.version_id,p.week_start,p.week_end,p.projection_envelope,l.document_json into prior
 from public.weekly_schedule_compiled_projections p join public.weekly_schedule_lunch_documents l using(projection_id)
 where p.publication_id=p_publication and p.version_id=version and p.week_start=frame and p.week_end=frame+6
  and p.exception_set_digest=public.static_weekly_digest_jsonb(public.static_weekly_manual_exception_summary(original_exceptions))
 order by p.compiled_at desc,p.projection_id desc limit 1;
 if found then
  prior_json:=jsonb_build_object('projectionId',prior.projection_id,'publicationId',prior.publication_id,'versionId',prior.version_id,
   'frameStart',prior.week_start::text,'frameEnd',prior.week_end::text,'lunchDocument',prior.document_json);
  day_bases:=coalesce(prior.projection_envelope#>'{authority,datedDayBases}','[]'::jsonb);
 end if;
 body:=jsonb_build_object('schema','custodial.approved-manual-period-basis.v1','managerId',p_manager,'actor',actor,
  'publicationId',p_publication,'versionId',version,'sourceId',sid,'frameStart',frame::text,'frameEnd',(frame+6)::text,
  'authorityRevision',original_revision,'currentServiceDate',public.sch_service_date(statement_timestamp())::text,
  'originalCommand',ctx->'originalCommand','originalSource',original_source,'normalSource',normal_source,
  'normalSourceDigest',public.static_weekly_digest_jsonb(normal_source),'ownerConfig',entry.owner_config,
  'catalogEntryDigest',entry.catalog_entry_digest,'generation',public.static_weekly_v15_read_recurring_generation(),
  'preparedExceptions',exceptions,'preparedSummary',summary,'priorProjection',prior_json,'priorDayBases',day_bases,
  'priorRefreshTargets',public.static_weekly_v11_read_current_refresh_targets(
   case when p_operation is null then frame else greatest(frame,(ctx#>>'{originalCommand,semanticBody,startDate}')::date) end,
   case when p_operation is null then frame+6 else least(frame+6,(ctx#>>'{originalCommand,semanticBody,endDate}')::date) end,p_manager));
 return body||jsonb_build_object('basisDigest',public.static_weekly_digest_jsonb(body));
end $fn$;
revoke all on function public.static_weekly_manual_period_basis(uuid,uuid,date,bigint,uuid) from public,anon,authenticated,service_role,
 static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_manual_period_basis(uuid,uuid,date,bigint,uuid) to static_weekly_control_plane;

-- Native validator/storage/lunch consumer amendments follow in this same draft.
-- Component SOURCE302_NATIVE_LUNCH_LINEAGE_20261030.sql
-- This small canonical serializer is used only for deterministic lunch keys.
-- It confers no receipt/approval authority and receives no credentials.
create or replace function public.static_weekly_manual_identity_json(p_value jsonb)
returns text language plpgsql immutable set search_path=pg_catalog,public as $fn$
declare result text;
begin
 case jsonb_typeof(p_value)
 when 'object' then select '{'||coalesce(string_agg(to_jsonb(k)::text||':'||public.static_weekly_manual_identity_json(v),',' order by k collate "C"),'')||'}' into result from jsonb_each(p_value) x(k,v);
 when 'array' then select '['||coalesce(string_agg(public.static_weekly_manual_identity_json(v),',' order by n),'')||']' into result from jsonb_array_elements(p_value) with ordinality x(v,n);
 else result:=p_value::text;
 end case;return result;
end $fn$;
revoke all on function public.static_weekly_manual_identity_json(jsonb) from public,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;

create or replace function public.static_weekly_manual_assert_lunch_lineage(p_envelope jsonb,p_document jsonb,p_publication uuid,p_week date)
returns void language plpgsql set search_path=pg_catalog,public as $fn$
declare retention jsonb:=p_envelope#>'{authority,lunchIdentityRetention}';prior jsonb;loan jsonb;old_loan jsonb;r jsonb;intent jsonb;
 record jsonb;fresh text;area_id text;expected jsonb;actual jsonb;expected_evidence jsonb;target text;edge jsonb;
 cost integer;total_cost integer;source jsonb:=p_envelope#>'{authority,compilerInput}';
begin
 if p_envelope->>'replay_digest' is distinct from public.static_weekly_digest_jsonb(jsonb_build_object(
  'projectionAssignments',p_envelope->'assignments','lunchDocument',p_document-array['base_authority_digest','base_replay_digest','document_identity']))
 then raise exception 'Manual native complete lunch replay differs';end if;
 if retention is not null then
  perform public.static_weekly_assert_exact_object(retention,array['schema','priorProjectionId','priorDocumentIdentity','loans','requiresSqlOwnerCurrentnessCheck'],array['schema','priorProjectionId','priorDocumentIdentity','loans','requiresSqlOwnerCurrentnessCheck'],'manual native retained lunch lineage');
  if retention->>'schema' is distinct from 'custodial.approved-manual-lunch-identity-retention.v1'
   or retention->'requiresSqlOwnerCurrentnessCheck' is distinct from 'true'::jsonb or jsonb_typeof(retention->'loans') is distinct from 'array'
   or (select count(*)<>count(distinct v->>'loanId') from jsonb_array_elements(retention->'loans') v)
  then raise exception 'Manual native retained lunch lineage malformed';end if;
  select l.document_json into strict prior from public.weekly_schedule_compiled_projections p join public.weekly_schedule_lunch_documents l using(projection_id)
   where p.projection_id=(retention->>'priorProjectionId')::uuid and p.publication_id=p_publication and p.week_start=p_week and p.week_end=p_week+6
    and p.version_id::text=p_envelope#>>'{authority,sourceVersionId}' and l.document_identity=retention->>'priorDocumentIdentity';
 end if;
 for loan in select value from jsonb_array_elements(p_document->'loans') loop
  fresh:=public.static_weekly_digest_text(public.static_weekly_manual_identity_json(jsonb_build_object(
   'policy','owner-20260921-two-nearby-full-hour-v1','input',p_envelope#>'{authority,overlayInputDigest}',
   'serviceDate',loan->'service_date','ownerSlotId',loan->'normal_owner_slot_id','start',loan->'coverage_start','end',loan->'coverage_end')));
  select v into record from jsonb_array_elements(coalesce(retention->'loans','[]')) v where v->'loanId'=loan->'loan_id';
  if record is not null then
   if record is distinct from jsonb_build_object('serviceDate',loan->'service_date','normalOwnerSlotId',loan->'normal_owner_slot_id','loanId',loan->'loan_id') then raise exception 'Manual native retained loan scope changed';end if;
   select v into strict old_loan from jsonb_array_elements(prior->'loans') v where v->'loan_id'=loan->'loan_id';
   if loan-array['loan_id','total_distance_minutes'] is distinct from old_loan-array['loan_id','total_distance_minutes'] then raise exception 'Manual native retained loan changed its helper or actual hour';end if;
   select coalesce(jsonb_agg(v-array['loan_id','responsibility_id','proximity_evidence'] order by (v-array['loan_id','responsibility_id','proximity_evidence'])::text),'[]') into expected from jsonb_array_elements(prior->'responsibilities') v where v->'loan_id'=loan->'loan_id';
   select coalesce(jsonb_agg(v-array['loan_id','responsibility_id','proximity_evidence'] order by (v-array['loan_id','responsibility_id','proximity_evidence'])::text),'[]') into actual from jsonb_array_elements(p_document->'responsibilities') v where v->'loan_id'=loan->'loan_id';
   if actual is distinct from expected then raise exception 'Manual native retained physical lunch duties changed';end if;
   select coalesce(jsonb_agg(v-array['loan_id','notification_key'] order by (v-array['loan_id','notification_key'])::text),'[]') into expected from jsonb_array_elements(prior->'notification_intents') v where v->'loan_id'=loan->'loan_id';
   select coalesce(jsonb_agg(v-array['loan_id','notification_key'] order by (v-array['loan_id','notification_key'])::text),'[]') into actual from jsonb_array_elements(p_document->'notification_intents') v where v->'loan_id'=loan->'loan_id';
   if actual is distinct from expected then raise exception 'Manual native retained delivery identities changed';end if;
  elsif loan->>'loan_id' is distinct from fresh then raise exception 'Manual native fresh loan key or retained immutable lineage differs';end if;
  total_cost:=0;
  for r in select value from jsonb_array_elements(p_document->'responsibilities') where value->'loan_id'=loan->'loan_id' loop
   select public.static_weekly_digest_text(public.static_weekly_manual_identity_json(jsonb_agg(jsonb_build_object(
    'work',s->'planWorkId','start',extract(epoch from (s#>>'{normalWindow,start}')::time)::integer/60,
    'end',extract(epoch from (s#>>'{normalWindow,end}')::time)::integer/60) order by s->>'planWorkId' collate "C"))) into area_id from jsonb_array_elements(r->'segments') s;
   fresh:=public.static_weekly_digest_text(public.static_weekly_manual_identity_json(jsonb_build_object('loanId',r->'loan_id','areaId',area_id,'covererSlotId',r->'coverer_slot_id')));
   if r->>'responsibility_id' is distinct from fresh then raise exception 'Manual native canonical physical responsibility key differs';end if;
   expected_evidence:='[]';cost:=0;
   for target in select distinct w#>>'{work_snapshot,locationId}' from jsonb_array_elements(r->'segments') s
    join jsonb_array_elements(p_envelope->'assignments') w on w->'plan_work_id'=s->'planWorkId' and w->'service_date'=r->'service_date'
    order by 1 loop
    with anchors as (
     select distinct w#>>'{work_snapshot,locationId}' id from jsonb_array_elements(p_envelope->'assignments') w
      where w->'service_date'=r->'service_date' and w->'owner_slot_id'=r->'coverer_slot_id'
       and w#>>'{work_snapshot,window,start}'<loan->>'coverage_end' and loan->>'coverage_start'<w#>>'{work_snapshot,window,end}'
    ), choices as (
     select jsonb_build_object('fromLocationId',id,'toLocationId',target,'minutes',0,'provenance','same_normal_assigned_area') value from anchors where id=target
     union all
     select jsonb_build_object('fromLocationId',id,'toLocationId',target,'minutes',e->'minutes','provenance',e->'provenance')
      from anchors join jsonb_array_elements(source->'proximity') e on
       (e->>'fromLocationId'=id and e->>'toLocationId'=target or e->>'toLocationId'=id and e->>'fromLocationId'=target)
      where e->'verified'='true'::jsonb and jsonb_typeof(e->'minutes')='number' and coalesce(e->>'provenance','')<>''
    ) select value into edge from choices order by (value->>'minutes')::integer,value->>'fromLocationId' collate "C",value->>'provenance' collate "C" limit 1;
    if edge is null then raise exception 'Manual native full-hour helper lacks verified proximity evidence';end if;
    expected_evidence:=expected_evidence||jsonb_build_array(edge);cost:=greatest(cost,(edge->>'minutes')::integer);
   end loop;
   if r->'proximity_evidence' is distinct from expected_evidence then raise exception 'Manual native full-hour proximity differs from actual source edges and current helper areas';end if;
   total_cost:=total_cost+cost;
  end loop;
  if loan->'total_distance_minutes' is distinct from to_jsonb(total_cost) then raise exception 'Manual native lunch proximity total differs';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(coalesce(retention->'loans','[]')) retained_item where not exists(select 1 from jsonb_array_elements(p_document->'loans') l where l->'loan_id'=retained_item->'loanId')) then raise exception 'Manual native unused retained lunch key';end if;
 for intent in select value from jsonb_array_elements(p_document->'notification_intents') loop
  fresh:=public.static_weekly_digest_text(public.static_weekly_manual_identity_json(jsonb_build_object('loanId',intent->'loan_id','slot',intent->'coverer_slot_id','event',intent->'event')));
  if intent->>'notification_key' is distinct from fresh then raise exception 'Manual native canonical lunch notification key differs';end if;
 end loop;
end $fn$;
revoke all on function public.static_weekly_manual_assert_lunch_lineage(jsonb,jsonb,uuid,date) from public,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;
-- Component SOURCE302_NATIVE_COMPONENTS_GENERATED_20261030.sql
-- Owned fixture working component, not a canonical migration or production admission.
set local statement_timeout='120s';
create or replace function public.static_weekly_manual_absence_policy() returns jsonb language sql immutable set search_path=pg_catalog,public as $policy$ select $data${"schema":"custodial.approved-manual-absence-policy-sql.v1","manifestSha256":"fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f","manualDataDigest":"eeff371f1510c6e4a079bde3ba17136dc10f64b100c7562d9b139fd14805a1c8","days":[{"day":"monday","weekday":1,"sourcePath":"sources/custodial_manual_monday_working_draft.json","employees":[{"name":"Tammy Miller","shift":{"start":"05:00","end":"14:00"},"lunch":{"start":"08:30","end":"09:30"},"baseGroups":["Teton and restrooms","Northwest Passage","East End restrooms"],"basePoints":24},{"name":"Karen Robinson","shift":{"start":"05:00","end":"14:00"},"lunch":{"start":"09:30","end":"10:30"},"baseGroups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms"],"basePoints":18},{"name":"Alijah Collins","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"11:30","end":"12:30"},"baseGroups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms"],"basePoints":19},{"name":"Jada Rawlings","shift":{"start":"06:00","end":"15:00"},"lunch":{"start":"10:00","end":"11:00"},"baseGroups":["Cat House Cafe restrooms","Tropical Birds","Cat Country","Komodos"],"basePoints":18},{"name":"Kiltra Horton","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"12:00","end":"13:00"},"baseGroups":["China and restrooms","Event Center and restrooms","Herpetarium"],"basePoints":17},{"name":"Xavier Green","shift":{"start":"08:00","end":"17:00"},"lunch":{"start":"12:30","end":"13:30"},"baseGroups":["Expo and restrooms","MemMex restrooms","Aquarium"],"basePoints":20},{"name":"Derrick Henderson","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"10:30","end":"11:30"},"baseGroups":["Education (includes Volunteer, IT, Interpretation, and four classrooms)","Nocturnal","Primate Canyon","Bonobos restrooms"],"basePoints":20}],"lunches":[{"recipient":"Tammy Miller","coverer":"Kiltra Horton","start":"08:30","end":"09:30","groups":["Teton and restrooms","Northwest Passage","East End restrooms"],"retainsOwnBase":true},{"recipient":"Karen Robinson","coverer":"Alijah Collins","start":"09:30","end":"10:30","groups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms"],"retainsOwnBase":true},{"recipient":"Jada Rawlings","coverer":"Kiltra Horton","start":"10:00","end":"11:00","groups":["Cat House Cafe restrooms","Tropical Birds","Cat Country","Komodos"],"retainsOwnBase":true},{"recipient":"Derrick Henderson","coverer":"Karen Robinson","start":"10:30","end":"11:30","groups":["Education (includes Volunteer, IT, Interpretation, and four classrooms)","Nocturnal","Primate Canyon","Bonobos restrooms"],"retainsOwnBase":true},{"recipient":"Alijah Collins","coverer":"Jada Rawlings","start":"11:30","end":"12:30","groups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms"],"retainsOwnBase":true},{"recipient":"Kiltra Horton","coverer":"Derrick Henderson","start":"12:00","end":"13:00","groups":["China and restrooms","Event Center and restrooms","Herpetarium"],"retainsOwnBase":true},{"recipient":"Xavier Green","coverer":"Jada Rawlings","start":"12:30","end":"13:30","groups":["Expo and restrooms","MemMex restrooms","Aquarium"],"retainsOwnBase":true}],"transfers":[{"time":"14:00","from":"Tammy Miller","to":"Kiltra Horton","group":"East End restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Kiltra Horton","group":"Northwest Passage","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Jada Rawlings","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Jada Rawlings","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Alijah Collins","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Alijah Collins","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Kiltra Horton","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Kiltra Horton","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Derrick Henderson","group":"Cat House Cafe restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Derrick Henderson","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Derrick Henderson","group":"Cat Country","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Derrick Henderson","group":"Komodos","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"East Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"West Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"Courtyard restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"China and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Event Center and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Herpetarium","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"East End restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Northwest Passage","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Education (includes Volunteer, IT, Interpretation, and four classrooms)","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Nocturnal","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Primate Canyon","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Bonobos restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Cat House Cafe restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Cat Country","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Komodos","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false}],"phases":[{"start":"08:00","owners":{"Teton and restrooms":"Tammy Miller","Northwest Passage":"Tammy Miller","East End restrooms":"Tammy Miller","Zambezi and restrooms":"Karen Robinson","Primate Pavilion":"Karen Robinson","Breezeway restrooms":"Karen Robinson","East Admin and restrooms":"Alijah Collins","West Admin and restrooms":"Alijah Collins","Courtyard restrooms":"Alijah Collins","Cat House Cafe restrooms":"Jada Rawlings","Tropical Birds":"Jada Rawlings","Cat Country":"Jada Rawlings","Komodos":"Jada Rawlings","China and restrooms":"Kiltra Horton","Event Center and restrooms":"Kiltra Horton","Herpetarium":"Kiltra Horton","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Derrick Henderson","Nocturnal":"Derrick Henderson","Primate Canyon":"Derrick Henderson","Bonobos restrooms":"Derrick Henderson"},"end":"14:00","zooWideCoverage":false,"points":{"Tammy Miller":24,"Karen Robinson":18,"Alijah Collins":19,"Jada Rawlings":18,"Kiltra Horton":17,"Xavier Green":20,"Derrick Henderson":20}},{"start":"14:00","owners":{"Teton and restrooms":"Jada Rawlings","Northwest Passage":"Kiltra Horton","East End restrooms":"Kiltra Horton","Zambezi and restrooms":"Jada Rawlings","Primate Pavilion":"Alijah Collins","Breezeway restrooms":"Alijah Collins","East Admin and restrooms":"Alijah Collins","West Admin and restrooms":"Alijah Collins","Courtyard restrooms":"Alijah Collins","Cat House Cafe restrooms":"Jada Rawlings","Tropical Birds":"Jada Rawlings","Cat Country":"Jada Rawlings","Komodos":"Jada Rawlings","China and restrooms":"Kiltra Horton","Event Center and restrooms":"Kiltra Horton","Herpetarium":"Kiltra Horton","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Derrick Henderson","Nocturnal":"Derrick Henderson","Primate Canyon":"Derrick Henderson","Bonobos restrooms":"Derrick Henderson"},"end":"15:00","zooWideCoverage":false,"points":{"Jada Rawlings":37,"Kiltra Horton":31,"Alijah Collins":28,"Xavier Green":20,"Derrick Henderson":20}},{"start":"15:00","owners":{"Teton and restrooms":"Kiltra Horton","Northwest Passage":"Kiltra Horton","East End restrooms":"Kiltra Horton","Zambezi and restrooms":"Kiltra Horton","Primate Pavilion":"Alijah Collins","Breezeway restrooms":"Alijah Collins","East Admin and restrooms":"Alijah Collins","West Admin and restrooms":"Alijah Collins","Courtyard restrooms":"Alijah Collins","Cat House Cafe restrooms":"Derrick Henderson","Tropical Birds":"Derrick Henderson","Cat Country":"Derrick Henderson","Komodos":"Derrick Henderson","China and restrooms":"Kiltra Horton","Event Center and restrooms":"Kiltra Horton","Herpetarium":"Kiltra Horton","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Derrick Henderson","Nocturnal":"Derrick Henderson","Primate Canyon":"Derrick Henderson","Bonobos restrooms":"Derrick Henderson"},"end":"16:00","zooWideCoverage":false,"points":{"Kiltra Horton":50,"Alijah Collins":28,"Derrick Henderson":38,"Xavier Green":20}},{"start":"16:00","owners":{"Teton and restrooms":"Xavier Green","Northwest Passage":"Xavier Green","East End restrooms":"Xavier Green","Zambezi and restrooms":"Xavier Green","Primate Pavilion":"Xavier Green","Breezeway restrooms":"Xavier Green","East Admin and restrooms":"Xavier Green","West Admin and restrooms":"Xavier Green","Courtyard restrooms":"Xavier Green","Cat House Cafe restrooms":"Xavier Green","Tropical Birds":"Xavier Green","Cat Country":"Xavier Green","Komodos":"Xavier Green","China and restrooms":"Xavier Green","Event Center and restrooms":"Xavier Green","Herpetarium":"Xavier Green","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Xavier Green","Nocturnal":"Xavier Green","Primate Canyon":"Xavier Green","Bonobos restrooms":"Xavier Green"},"end":"17:00","zooWideCoverage":true,"points":{"Xavier Green":136}}],"checkedWindow":{"start":"08:00","end":"17:00"},"prearrivalPolicy":"UNRESOLVED","policy0945":"OWNER_APPROVED_NO_CHANGEOVER","coveragePurpose":"INHERITED_AREAS_ARE_ALERT_AND_ISSUE_CUSTODY_NOT_EXTRA_MANDATORY_CLEANING"},{"day":"tuesday","weekday":2,"sourcePath":"sources/custodial_manual_tuesday_working_draft.json","employees":[{"name":"Tammy Miller","shift":{"start":"05:00","end":"14:00"},"lunch":{"start":"08:30","end":"09:30"},"baseGroups":["Teton and restrooms","Northwest Passage","East End restrooms"],"basePoints":24},{"name":"Karen Robinson","shift":{"start":"05:00","end":"14:00"},"lunch":{"start":"09:30","end":"10:30"},"baseGroups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds"],"basePoints":23},{"name":"Kathy Phelps","shift":{"start":"06:00","end":"15:00"},"lunch":{"start":"10:30","end":"11:30"},"baseGroups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Nocturnal","Primate Canyon"],"basePoints":23},{"name":"Jada Rawlings","shift":{"start":"06:00","end":"15:00"},"lunch":{"start":"10:00","end":"11:00"},"baseGroups":["Cat House Cafe restrooms","Herpetarium","Event Center and restrooms","Cat Country","Komodos"],"basePoints":23},{"name":"Derrick Henderson","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"10:30","end":"11:30"},"baseGroups":["Education (includes Volunteer, IT, Interpretation, and four classrooms)","China and restrooms","Bonobos restrooms"],"basePoints":23},{"name":"Xavier Green","shift":{"start":"08:00","end":"17:00"},"lunch":{"start":"12:30","end":"13:30"},"baseGroups":["Expo and restrooms","MemMex restrooms","Aquarium"],"basePoints":20}],"lunches":[{"recipient":"Tammy Miller","coverer":"Karen Robinson","start":"08:30","end":"09:30","groups":["Teton and restrooms","Northwest Passage","East End restrooms"],"retainsOwnBase":true},{"recipient":"Karen Robinson","coverer":"Tammy Miller","start":"09:30","end":"10:30","groups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds"],"retainsOwnBase":true},{"recipient":"Jada Rawlings","coverer":"Xavier Green","start":"10:00","end":"11:00","groups":["Cat House Cafe restrooms","Herpetarium","Event Center and restrooms","Cat Country","Komodos"],"retainsOwnBase":true},{"recipient":"Kathy Phelps","coverer":"Tammy Miller","start":"10:30","end":"11:30","groups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Nocturnal","Primate Canyon"],"retainsOwnBase":true},{"recipient":"Derrick Henderson","coverer":"Karen Robinson","start":"10:30","end":"11:30","groups":["Education (includes Volunteer, IT, Interpretation, and four classrooms)","China and restrooms","Bonobos restrooms"],"retainsOwnBase":true},{"recipient":"Xavier Green","coverer":"Jada Rawlings","start":"12:30","end":"13:30","groups":["Expo and restrooms","MemMex restrooms","Aquarium"],"retainsOwnBase":true}],"transfers":[{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Jada Rawlings","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Jada Rawlings","group":"Northwest Passage","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Jada Rawlings","group":"East End restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"East Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"West Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Courtyard restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Nocturnal","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Primate Canyon","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"Cat House Cafe restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"Herpetarium","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"Event Center and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"Cat Country","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"Komodos","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"Northwest Passage","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"East End restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Education (includes Volunteer, IT, Interpretation, and four classrooms)","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"China and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Bonobos restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"East Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"West Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Courtyard restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Nocturnal","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Primate Canyon","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false}],"phases":[{"start":"08:00","owners":{"Teton and restrooms":"Tammy Miller","Northwest Passage":"Tammy Miller","East End restrooms":"Tammy Miller","Zambezi and restrooms":"Karen Robinson","Primate Pavilion":"Karen Robinson","Breezeway restrooms":"Karen Robinson","Tropical Birds":"Karen Robinson","East Admin and restrooms":"Kathy Phelps","West Admin and restrooms":"Kathy Phelps","Courtyard restrooms":"Kathy Phelps","Nocturnal":"Kathy Phelps","Primate Canyon":"Kathy Phelps","Cat House Cafe restrooms":"Jada Rawlings","Herpetarium":"Jada Rawlings","Event Center and restrooms":"Jada Rawlings","Cat Country":"Jada Rawlings","Komodos":"Jada Rawlings","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Derrick Henderson","China and restrooms":"Derrick Henderson","Bonobos restrooms":"Derrick Henderson","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green"},"end":"14:00","zooWideCoverage":false,"points":{"Tammy Miller":24,"Karen Robinson":23,"Kathy Phelps":23,"Jada Rawlings":23,"Derrick Henderson":23,"Xavier Green":20}},{"start":"14:00","owners":{"Teton and restrooms":"Jada Rawlings","Northwest Passage":"Jada Rawlings","East End restrooms":"Jada Rawlings","Zambezi and restrooms":"Kathy Phelps","Primate Pavilion":"Kathy Phelps","Breezeway restrooms":"Kathy Phelps","Tropical Birds":"Kathy Phelps","East Admin and restrooms":"Kathy Phelps","West Admin and restrooms":"Kathy Phelps","Courtyard restrooms":"Kathy Phelps","Nocturnal":"Kathy Phelps","Primate Canyon":"Kathy Phelps","Cat House Cafe restrooms":"Jada Rawlings","Herpetarium":"Jada Rawlings","Event Center and restrooms":"Jada Rawlings","Cat Country":"Jada Rawlings","Komodos":"Jada Rawlings","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Derrick Henderson","China and restrooms":"Derrick Henderson","Bonobos restrooms":"Derrick Henderson","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green"},"end":"15:00","zooWideCoverage":false,"points":{"Jada Rawlings":47,"Kathy Phelps":46,"Derrick Henderson":23,"Xavier Green":20}},{"start":"15:00","owners":{"Teton and restrooms":"Xavier Green","Northwest Passage":"Xavier Green","East End restrooms":"Xavier Green","Zambezi and restrooms":"Derrick Henderson","Primate Pavilion":"Derrick Henderson","Breezeway restrooms":"Derrick Henderson","Tropical Birds":"Derrick Henderson","East Admin and restrooms":"Derrick Henderson","West Admin and restrooms":"Derrick Henderson","Courtyard restrooms":"Derrick Henderson","Nocturnal":"Derrick Henderson","Primate Canyon":"Derrick Henderson","Cat House Cafe restrooms":"Xavier Green","Herpetarium":"Xavier Green","Event Center and restrooms":"Xavier Green","Cat Country":"Xavier Green","Komodos":"Xavier Green","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Derrick Henderson","China and restrooms":"Derrick Henderson","Bonobos restrooms":"Derrick Henderson","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green"},"end":"16:00","zooWideCoverage":false,"points":{"Xavier Green":67,"Derrick Henderson":69}},{"start":"16:00","owners":{"Teton and restrooms":"Xavier Green","Northwest Passage":"Xavier Green","East End restrooms":"Xavier Green","Zambezi and restrooms":"Xavier Green","Primate Pavilion":"Xavier Green","Breezeway restrooms":"Xavier Green","Tropical Birds":"Xavier Green","East Admin and restrooms":"Xavier Green","West Admin and restrooms":"Xavier Green","Courtyard restrooms":"Xavier Green","Nocturnal":"Xavier Green","Primate Canyon":"Xavier Green","Cat House Cafe restrooms":"Xavier Green","Herpetarium":"Xavier Green","Event Center and restrooms":"Xavier Green","Cat Country":"Xavier Green","Komodos":"Xavier Green","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Xavier Green","China and restrooms":"Xavier Green","Bonobos restrooms":"Xavier Green","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green"},"end":"17:00","zooWideCoverage":true,"points":{"Xavier Green":136}}],"checkedWindow":{"start":"08:00","end":"17:00"},"prearrivalPolicy":"UNRESOLVED","policy0945":"OWNER_APPROVED_NO_CHANGEOVER","coveragePurpose":"INHERITED_AREAS_ARE_ALERT_AND_ISSUE_CUSTODY_NOT_EXTRA_MANDATORY_CLEANING"},{"day":"wednesday","weekday":3,"sourcePath":"sources/custodial_manual_wednesday_working_draft.json","employees":[{"name":"Tammy Miller","shift":{"start":"05:00","end":"14:00"},"lunch":{"start":"08:30","end":"09:30"},"baseGroups":["Teton and restrooms","Northwest Passage","East End restrooms"],"basePoints":24},{"name":"Karen Robinson","shift":{"start":"05:00","end":"14:00"},"lunch":{"start":"09:30","end":"10:30"},"baseGroups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds","Nocturnal","Primate Canyon"],"basePoints":27},{"name":"Kathy Phelps","shift":{"start":"06:00","end":"15:00"},"lunch":{"start":"10:30","end":"11:30"},"baseGroups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Education (includes Volunteer, IT, Interpretation, and four classrooms)","Cat Country"],"basePoints":29},{"name":"Derrick Henderson","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"10:30","end":"11:30"},"baseGroups":["China and restrooms","Bonobos restrooms","Herpetarium","Cat House Cafe restrooms"],"basePoints":27},{"name":"Xavier Green","shift":{"start":"08:00","end":"17:00"},"lunch":{"start":"12:30","end":"13:30"},"baseGroups":["Expo and restrooms","MemMex restrooms","Aquarium","Event Center and restrooms","Komodos"],"basePoints":29}],"lunches":[{"recipient":"Tammy Miller","coverer":"Karen Robinson","start":"08:30","end":"09:30","groups":["Teton and restrooms","Northwest Passage","East End restrooms"],"retainsOwnBase":true},{"recipient":"Karen Robinson","coverer":"Derrick Henderson","start":"09:30","end":"10:30","groups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds","Nocturnal","Primate Canyon"],"retainsOwnBase":true},{"recipient":"Kathy Phelps","coverer":"Karen Robinson","start":"10:30","end":"11:30","groups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Education (includes Volunteer, IT, Interpretation, and four classrooms)","Cat Country"],"retainsOwnBase":true},{"recipient":"Derrick Henderson","coverer":"Xavier Green","start":"10:30","end":"11:30","groups":["China and restrooms","Bonobos restrooms","Herpetarium","Cat House Cafe restrooms"],"retainsOwnBase":true},{"recipient":"Xavier Green","coverer":"Derrick Henderson","start":"12:30","end":"13:30","groups":["Expo and restrooms","MemMex restrooms","Aquarium","Event Center and restrooms","Komodos"],"retainsOwnBase":true}],"transfers":[{"time":"14:00","from":"Tammy Miller","to":"Derrick Henderson","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Derrick Henderson","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Nocturnal","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Primate Canyon","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Xavier Green","group":"Northwest Passage","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Xavier Green","group":"East End restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"East Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Courtyard restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Primate Canyon","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Xavier Green","group":"West Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Xavier Green","group":"Education (includes Volunteer, IT, Interpretation, and four classrooms)","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Xavier Green","group":"Cat Country","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Xavier Green","group":"Nocturnal","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Xavier Green","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"China and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Bonobos restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Herpetarium","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Cat House Cafe restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"East Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Courtyard restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Primate Canyon","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false}],"phases":[{"start":"08:00","owners":{"Teton and restrooms":"Tammy Miller","Northwest Passage":"Tammy Miller","East End restrooms":"Tammy Miller","Zambezi and restrooms":"Karen Robinson","Primate Pavilion":"Karen Robinson","Breezeway restrooms":"Karen Robinson","Tropical Birds":"Karen Robinson","Nocturnal":"Karen Robinson","Primate Canyon":"Karen Robinson","East Admin and restrooms":"Kathy Phelps","West Admin and restrooms":"Kathy Phelps","Courtyard restrooms":"Kathy Phelps","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Kathy Phelps","Cat Country":"Kathy Phelps","China and restrooms":"Derrick Henderson","Bonobos restrooms":"Derrick Henderson","Herpetarium":"Derrick Henderson","Cat House Cafe restrooms":"Derrick Henderson","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green","Event Center and restrooms":"Xavier Green","Komodos":"Xavier Green"},"end":"14:00","zooWideCoverage":false,"points":{"Tammy Miller":24,"Karen Robinson":27,"Kathy Phelps":29,"Derrick Henderson":27,"Xavier Green":29}},{"start":"14:00","owners":{"Teton and restrooms":"Derrick Henderson","Northwest Passage":"Xavier Green","East End restrooms":"Xavier Green","Zambezi and restrooms":"Derrick Henderson","Primate Pavilion":"Kathy Phelps","Breezeway restrooms":"Kathy Phelps","Tropical Birds":"Kathy Phelps","Nocturnal":"Kathy Phelps","Primate Canyon":"Kathy Phelps","East Admin and restrooms":"Kathy Phelps","West Admin and restrooms":"Kathy Phelps","Courtyard restrooms":"Kathy Phelps","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Kathy Phelps","Cat Country":"Kathy Phelps","China and restrooms":"Derrick Henderson","Bonobos restrooms":"Derrick Henderson","Herpetarium":"Derrick Henderson","Cat House Cafe restrooms":"Derrick Henderson","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green","Event Center and restrooms":"Xavier Green","Komodos":"Xavier Green"},"end":"15:00","zooWideCoverage":false,"points":{"Derrick Henderson":46,"Xavier Green":43,"Kathy Phelps":47}},{"start":"15:00","owners":{"Teton and restrooms":"Derrick Henderson","Northwest Passage":"Xavier Green","East End restrooms":"Xavier Green","Zambezi and restrooms":"Derrick Henderson","Primate Pavilion":"Derrick Henderson","Breezeway restrooms":"Derrick Henderson","Tropical Birds":"Xavier Green","Nocturnal":"Xavier Green","Primate Canyon":"Derrick Henderson","East Admin and restrooms":"Derrick Henderson","West Admin and restrooms":"Xavier Green","Courtyard restrooms":"Derrick Henderson","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Xavier Green","Cat Country":"Xavier Green","China and restrooms":"Derrick Henderson","Bonobos restrooms":"Derrick Henderson","Herpetarium":"Derrick Henderson","Cat House Cafe restrooms":"Derrick Henderson","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green","Event Center and restrooms":"Xavier Green","Komodos":"Xavier Green"},"end":"16:00","zooWideCoverage":false,"points":{"Derrick Henderson":68,"Xavier Green":68}},{"start":"16:00","owners":{"Teton and restrooms":"Xavier Green","Northwest Passage":"Xavier Green","East End restrooms":"Xavier Green","Zambezi and restrooms":"Xavier Green","Primate Pavilion":"Xavier Green","Breezeway restrooms":"Xavier Green","Tropical Birds":"Xavier Green","Nocturnal":"Xavier Green","Primate Canyon":"Xavier Green","East Admin and restrooms":"Xavier Green","West Admin and restrooms":"Xavier Green","Courtyard restrooms":"Xavier Green","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Xavier Green","Cat Country":"Xavier Green","China and restrooms":"Xavier Green","Bonobos restrooms":"Xavier Green","Herpetarium":"Xavier Green","Cat House Cafe restrooms":"Xavier Green","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green","Event Center and restrooms":"Xavier Green","Komodos":"Xavier Green"},"end":"17:00","zooWideCoverage":true,"points":{"Xavier Green":136}}],"checkedWindow":{"start":"08:00","end":"17:00"},"prearrivalPolicy":"UNRESOLVED","policy0945":"OWNER_APPROVED_NO_CHANGEOVER","coveragePurpose":"INHERITED_AREAS_ARE_ALERT_AND_ISSUE_CUSTODY_NOT_EXTRA_MANDATORY_CLEANING"},{"day":"thursday","weekday":4,"sourcePath":"sources/custodial_manual_thursday_working_draft.json","employees":[{"name":"Tammy Miller","shift":{"start":"05:00","end":"14:00"},"lunch":{"start":"08:30","end":"09:30"},"baseGroups":["Teton and restrooms","Northwest Passage","East End restrooms"],"basePoints":24},{"name":"Kathy Phelps","shift":{"start":"06:00","end":"15:00"},"lunch":{"start":"10:30","end":"11:30"},"baseGroups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Education (includes Volunteer, IT, Interpretation, and four classrooms)","Cat Country"],"basePoints":29},{"name":"Alijah Collins","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"11:30","end":"12:30"},"baseGroups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds","Nocturnal","Primate Canyon"],"basePoints":27},{"name":"Kiltra Horton","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"12:00","end":"13:00"},"baseGroups":["China and restrooms","Bonobos restrooms","Cat House Cafe restrooms","Event Center and restrooms"],"basePoints":27},{"name":"Derrick Henderson","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"10:30","end":"11:30"},"baseGroups":["Expo and restrooms","MemMex restrooms","Aquarium","Komodos","Herpetarium"],"basePoints":29}],"lunches":[{"recipient":"Tammy Miller","coverer":"Kiltra Horton","start":"08:30","end":"09:30","groups":["Teton and restrooms","Northwest Passage","East End restrooms"],"retainsOwnBase":true},{"recipient":"Kathy Phelps","coverer":"Alijah Collins","start":"10:30","end":"11:30","groups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Education (includes Volunteer, IT, Interpretation, and four classrooms)","Cat Country"],"retainsOwnBase":true},{"recipient":"Derrick Henderson","coverer":"Kiltra Horton","start":"10:30","end":"11:30","groups":["Expo and restrooms","MemMex restrooms","Aquarium","Komodos","Herpetarium"],"retainsOwnBase":true},{"recipient":"Alijah Collins","coverer":"Kathy Phelps","start":"11:30","end":"12:30","groups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds","Nocturnal","Primate Canyon"],"retainsOwnBase":true},{"recipient":"Kiltra Horton","coverer":"Derrick Henderson","start":"12:00","end":"13:00","groups":["China and restrooms","Bonobos restrooms","Cat House Cafe restrooms","Event Center and restrooms"],"retainsOwnBase":true}],"transfers":[{"time":"14:00","from":"Tammy Miller","to":"Alijah Collins","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Kiltra Horton","group":"Northwest Passage","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Kiltra Horton","group":"East End restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Alijah Collins","group":"Education (includes Volunteer, IT, Interpretation, and four classrooms)","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Kiltra Horton","group":"East Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"West Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Courtyard restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Derrick Henderson","group":"Cat Country","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false}],"phases":[{"start":"07:00","owners":{"Teton and restrooms":"Tammy Miller","Northwest Passage":"Tammy Miller","East End restrooms":"Tammy Miller","East Admin and restrooms":"Kathy Phelps","West Admin and restrooms":"Kathy Phelps","Courtyard restrooms":"Kathy Phelps","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Kathy Phelps","Cat Country":"Kathy Phelps","Zambezi and restrooms":"Alijah Collins","Primate Pavilion":"Alijah Collins","Breezeway restrooms":"Alijah Collins","Tropical Birds":"Alijah Collins","Nocturnal":"Alijah Collins","Primate Canyon":"Alijah Collins","China and restrooms":"Kiltra Horton","Bonobos restrooms":"Kiltra Horton","Cat House Cafe restrooms":"Kiltra Horton","Event Center and restrooms":"Kiltra Horton","Expo and restrooms":"Derrick Henderson","MemMex restrooms":"Derrick Henderson","Aquarium":"Derrick Henderson","Komodos":"Derrick Henderson","Herpetarium":"Derrick Henderson"},"end":"14:00","zooWideCoverage":false,"points":{"Tammy Miller":24,"Kathy Phelps":29,"Alijah Collins":27,"Kiltra Horton":27,"Derrick Henderson":29}},{"start":"14:00","owners":{"Teton and restrooms":"Alijah Collins","Northwest Passage":"Kiltra Horton","East End restrooms":"Kiltra Horton","East Admin and restrooms":"Kathy Phelps","West Admin and restrooms":"Kathy Phelps","Courtyard restrooms":"Kathy Phelps","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Kathy Phelps","Cat Country":"Kathy Phelps","Zambezi and restrooms":"Alijah Collins","Primate Pavilion":"Alijah Collins","Breezeway restrooms":"Alijah Collins","Tropical Birds":"Alijah Collins","Nocturnal":"Alijah Collins","Primate Canyon":"Alijah Collins","China and restrooms":"Kiltra Horton","Bonobos restrooms":"Kiltra Horton","Cat House Cafe restrooms":"Kiltra Horton","Event Center and restrooms":"Kiltra Horton","Expo and restrooms":"Derrick Henderson","MemMex restrooms":"Derrick Henderson","Aquarium":"Derrick Henderson","Komodos":"Derrick Henderson","Herpetarium":"Derrick Henderson"},"end":"15:00","zooWideCoverage":false,"points":{"Alijah Collins":37,"Kiltra Horton":41,"Kathy Phelps":29,"Derrick Henderson":29}},{"start":"15:00","owners":{"Teton and restrooms":"Alijah Collins","Northwest Passage":"Kiltra Horton","East End restrooms":"Kiltra Horton","East Admin and restrooms":"Kiltra Horton","West Admin and restrooms":"Derrick Henderson","Courtyard restrooms":"Derrick Henderson","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Alijah Collins","Cat Country":"Derrick Henderson","Zambezi and restrooms":"Alijah Collins","Primate Pavilion":"Alijah Collins","Breezeway restrooms":"Alijah Collins","Tropical Birds":"Alijah Collins","Nocturnal":"Alijah Collins","Primate Canyon":"Alijah Collins","China and restrooms":"Kiltra Horton","Bonobos restrooms":"Kiltra Horton","Cat House Cafe restrooms":"Kiltra Horton","Event Center and restrooms":"Kiltra Horton","Expo and restrooms":"Derrick Henderson","MemMex restrooms":"Derrick Henderson","Aquarium":"Derrick Henderson","Komodos":"Derrick Henderson","Herpetarium":"Derrick Henderson"},"end":"16:00","zooWideCoverage":false,"points":{"Alijah Collins":45,"Kiltra Horton":46,"Derrick Henderson":45}}],"checkedWindow":{"start":"07:00","end":"16:00"},"prearrivalPolicy":"UNRESOLVED","policy0945":"OWNER_APPROVED_NO_CHANGEOVER","coveragePurpose":"INHERITED_AREAS_ARE_ALERT_AND_ISSUE_CUSTODY_NOT_EXTRA_MANDATORY_CLEANING"},{"day":"friday","weekday":5,"sourcePath":"sources/custodial_manual_friday_working_draft.json","employees":[{"name":"Tammy Miller","shift":{"start":"05:00","end":"14:00"},"lunch":{"start":"08:30","end":"09:30"},"baseGroups":["Teton and restrooms","Northwest Passage","East End restrooms"],"basePoints":24},{"name":"Karen Robinson","shift":{"start":"05:00","end":"14:00"},"lunch":{"start":"09:30","end":"10:30"},"baseGroups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds"],"basePoints":23},{"name":"Kathy Phelps","shift":{"start":"06:00","end":"15:00"},"lunch":{"start":"10:30","end":"11:30"},"baseGroups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Nocturnal","Primate Canyon"],"basePoints":23},{"name":"Jada Rawlings","shift":{"start":"06:00","end":"15:00"},"lunch":{"start":"10:00","end":"11:00"},"baseGroups":["Cat House Cafe restrooms","Herpetarium","Event Center and restrooms","Cat Country","Komodos"],"basePoints":23},{"name":"Kiltra Horton","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"12:00","end":"13:00"},"baseGroups":["Education (includes Volunteer, IT, Interpretation, and four classrooms)","China and restrooms","Bonobos restrooms"],"basePoints":23},{"name":"Alijah Collins","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"11:30","end":"12:30"},"baseGroups":["Expo and restrooms","MemMex restrooms","Aquarium"],"basePoints":20}],"lunches":[{"recipient":"Tammy Miller","coverer":"Kiltra Horton","start":"08:30","end":"09:30","groups":["Teton and restrooms","Northwest Passage","East End restrooms"],"retainsOwnBase":true},{"recipient":"Karen Robinson","coverer":"Alijah Collins","start":"09:30","end":"10:30","groups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds"],"retainsOwnBase":true},{"recipient":"Jada Rawlings","coverer":"Kiltra Horton","start":"10:00","end":"11:00","groups":["Cat House Cafe restrooms","Herpetarium","Event Center and restrooms","Cat Country","Komodos"],"retainsOwnBase":true},{"recipient":"Kathy Phelps","coverer":"Karen Robinson","start":"10:30","end":"11:30","groups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Nocturnal","Primate Canyon"],"retainsOwnBase":true},{"recipient":"Alijah Collins","coverer":"Jada Rawlings","start":"11:30","end":"12:30","groups":["Expo and restrooms","MemMex restrooms","Aquarium"],"retainsOwnBase":true},{"recipient":"Kiltra Horton","coverer":"Kathy Phelps","start":"12:00","end":"13:00","groups":["Education (includes Volunteer, IT, Interpretation, and four classrooms)","China and restrooms","Bonobos restrooms"],"retainsOwnBase":true}],"transfers":[{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Jada Rawlings","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Jada Rawlings","group":"Northwest Passage","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Tammy Miller","to":"Jada Rawlings","group":"East End restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Kiltra Horton","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Kiltra Horton","group":"Northwest Passage","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Kiltra Horton","group":"East End restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Kiltra Horton","group":"Cat Country","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Kiltra Horton","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Kiltra Horton","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Kiltra Horton","group":"East Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Kiltra Horton","group":"Primate Canyon","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Alijah Collins","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Alijah Collins","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Alijah Collins","group":"West Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Alijah Collins","group":"Courtyard restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Alijah Collins","group":"Nocturnal","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Alijah Collins","group":"Cat House Cafe restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Alijah Collins","group":"Herpetarium","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Alijah Collins","group":"Event Center and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Alijah Collins","group":"Komodos","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false}],"phases":[{"start":"07:00","owners":{"Teton and restrooms":"Tammy Miller","Northwest Passage":"Tammy Miller","East End restrooms":"Tammy Miller","Zambezi and restrooms":"Karen Robinson","Primate Pavilion":"Karen Robinson","Breezeway restrooms":"Karen Robinson","Tropical Birds":"Karen Robinson","East Admin and restrooms":"Kathy Phelps","West Admin and restrooms":"Kathy Phelps","Courtyard restrooms":"Kathy Phelps","Nocturnal":"Kathy Phelps","Primate Canyon":"Kathy Phelps","Cat House Cafe restrooms":"Jada Rawlings","Herpetarium":"Jada Rawlings","Event Center and restrooms":"Jada Rawlings","Cat Country":"Jada Rawlings","Komodos":"Jada Rawlings","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Kiltra Horton","China and restrooms":"Kiltra Horton","Bonobos restrooms":"Kiltra Horton","Expo and restrooms":"Alijah Collins","MemMex restrooms":"Alijah Collins","Aquarium":"Alijah Collins"},"end":"14:00","zooWideCoverage":false,"points":{"Tammy Miller":24,"Karen Robinson":23,"Kathy Phelps":23,"Jada Rawlings":23,"Kiltra Horton":23,"Alijah Collins":20}},{"start":"14:00","owners":{"Teton and restrooms":"Jada Rawlings","Northwest Passage":"Jada Rawlings","East End restrooms":"Jada Rawlings","Zambezi and restrooms":"Kathy Phelps","Primate Pavilion":"Kathy Phelps","Breezeway restrooms":"Kathy Phelps","Tropical Birds":"Kathy Phelps","East Admin and restrooms":"Kathy Phelps","West Admin and restrooms":"Kathy Phelps","Courtyard restrooms":"Kathy Phelps","Nocturnal":"Kathy Phelps","Primate Canyon":"Kathy Phelps","Cat House Cafe restrooms":"Jada Rawlings","Herpetarium":"Jada Rawlings","Event Center and restrooms":"Jada Rawlings","Cat Country":"Jada Rawlings","Komodos":"Jada Rawlings","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Kiltra Horton","China and restrooms":"Kiltra Horton","Bonobos restrooms":"Kiltra Horton","Expo and restrooms":"Alijah Collins","MemMex restrooms":"Alijah Collins","Aquarium":"Alijah Collins"},"end":"15:00","zooWideCoverage":false,"points":{"Jada Rawlings":47,"Kathy Phelps":46,"Kiltra Horton":23,"Alijah Collins":20}},{"start":"15:00","owners":{"Teton and restrooms":"Kiltra Horton","Northwest Passage":"Kiltra Horton","East End restrooms":"Kiltra Horton","Zambezi and restrooms":"Kiltra Horton","Primate Pavilion":"Kiltra Horton","Breezeway restrooms":"Alijah Collins","Tropical Birds":"Alijah Collins","East Admin and restrooms":"Kiltra Horton","West Admin and restrooms":"Alijah Collins","Courtyard restrooms":"Alijah Collins","Nocturnal":"Alijah Collins","Primate Canyon":"Kiltra Horton","Cat House Cafe restrooms":"Alijah Collins","Herpetarium":"Alijah Collins","Event Center and restrooms":"Alijah Collins","Cat Country":"Kiltra Horton","Komodos":"Alijah Collins","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Kiltra Horton","China and restrooms":"Kiltra Horton","Bonobos restrooms":"Kiltra Horton","Expo and restrooms":"Alijah Collins","MemMex restrooms":"Alijah Collins","Aquarium":"Alijah Collins"},"end":"16:00","zooWideCoverage":false,"points":{"Kiltra Horton":67,"Alijah Collins":69}}],"checkedWindow":{"start":"07:00","end":"16:00"},"prearrivalPolicy":"UNRESOLVED","policy0945":"OWNER_APPROVED_NO_CHANGEOVER","coveragePurpose":"INHERITED_AREAS_ARE_ALERT_AND_ISSUE_CUSTODY_NOT_EXTRA_MANDATORY_CLEANING"},{"day":"saturday","weekday":6,"sourcePath":"sources/custodial_manual_saturday_working_draft.json","employees":[{"name":"Alijah Collins","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"11:30","end":"12:30"},"baseGroups":["Teton and restrooms","Northwest Passage","East End restrooms"],"basePoints":24},{"name":"Karen Robinson","shift":{"start":"05:00","end":"14:00"},"lunch":{"start":"09:30","end":"10:30"},"baseGroups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds"],"basePoints":23},{"name":"Kathy Phelps","shift":{"start":"06:00","end":"15:00"},"lunch":{"start":"10:30","end":"11:30"},"baseGroups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Nocturnal","Primate Canyon"],"basePoints":23},{"name":"Jada Rawlings","shift":{"start":"06:00","end":"15:00"},"lunch":{"start":"10:00","end":"11:00"},"baseGroups":["Cat House Cafe restrooms","Herpetarium","Event Center and restrooms","Cat Country","Komodos"],"basePoints":23},{"name":"Kiltra Horton","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"12:00","end":"13:00"},"baseGroups":["Education (includes Volunteer, IT, Interpretation, and four classrooms)","China and restrooms","Bonobos restrooms"],"basePoints":23},{"name":"Xavier Green","shift":{"start":"08:00","end":"17:00"},"lunch":{"start":"12:30","end":"13:30"},"baseGroups":["Expo and restrooms","MemMex restrooms","Aquarium"],"basePoints":20}],"lunches":[{"recipient":"Karen Robinson","coverer":"Alijah Collins","start":"09:30","end":"10:30","groups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds"],"retainsOwnBase":true},{"recipient":"Jada Rawlings","coverer":"Kiltra Horton","start":"10:00","end":"11:00","groups":["Cat House Cafe restrooms","Herpetarium","Event Center and restrooms","Cat Country","Komodos"],"retainsOwnBase":true},{"recipient":"Kathy Phelps","coverer":"Karen Robinson","start":"10:30","end":"11:30","groups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Nocturnal","Primate Canyon"],"retainsOwnBase":true},{"recipient":"Alijah Collins","coverer":"Jada Rawlings","start":"11:30","end":"12:30","groups":["Teton and restrooms","Northwest Passage","East End restrooms"],"retainsOwnBase":true},{"recipient":"Kiltra Horton","coverer":"Kathy Phelps","start":"12:00","end":"13:00","groups":["Education (includes Volunteer, IT, Interpretation, and four classrooms)","China and restrooms","Bonobos restrooms"],"retainsOwnBase":true},{"recipient":"Xavier Green","coverer":"Jada Rawlings","start":"12:30","end":"13:30","groups":["Expo and restrooms","MemMex restrooms","Aquarium"],"retainsOwnBase":true}],"transfers":[{"time":"14:00","from":"Karen Robinson","to":"Alijah Collins","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Alijah Collins","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Kathy Phelps","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"14:00","from":"Karen Robinson","to":"Jada Rawlings","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Alijah Collins","group":"East Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Alijah Collins","group":"Nocturnal","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Alijah Collins","group":"Primate Canyon","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Kiltra Horton","group":"West Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Kiltra Horton","group":"Courtyard restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Kathy Phelps","to":"Kiltra Horton","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Kiltra Horton","group":"Cat House Cafe restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Kiltra Horton","group":"Cat Country","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"Herpetarium","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"Event Center and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"Komodos","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Xavier Green","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"Northwest Passage","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"East End restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"East Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"Nocturnal","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"Primate Canyon","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Education (includes Volunteer, IT, Interpretation, and four classrooms)","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"China and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Bonobos restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"West Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Courtyard restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Cat House Cafe restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Cat Country","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false}],"phases":[{"start":"08:00","owners":{"Teton and restrooms":"Alijah Collins","Northwest Passage":"Alijah Collins","East End restrooms":"Alijah Collins","Zambezi and restrooms":"Karen Robinson","Primate Pavilion":"Karen Robinson","Breezeway restrooms":"Karen Robinson","Tropical Birds":"Karen Robinson","East Admin and restrooms":"Kathy Phelps","West Admin and restrooms":"Kathy Phelps","Courtyard restrooms":"Kathy Phelps","Nocturnal":"Kathy Phelps","Primate Canyon":"Kathy Phelps","Cat House Cafe restrooms":"Jada Rawlings","Herpetarium":"Jada Rawlings","Event Center and restrooms":"Jada Rawlings","Cat Country":"Jada Rawlings","Komodos":"Jada Rawlings","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Kiltra Horton","China and restrooms":"Kiltra Horton","Bonobos restrooms":"Kiltra Horton","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green"},"end":"14:00","zooWideCoverage":false,"points":{"Alijah Collins":24,"Karen Robinson":23,"Kathy Phelps":23,"Jada Rawlings":23,"Kiltra Horton":23,"Xavier Green":20}},{"start":"14:00","owners":{"Teton and restrooms":"Alijah Collins","Northwest Passage":"Alijah Collins","East End restrooms":"Alijah Collins","Zambezi and restrooms":"Alijah Collins","Primate Pavilion":"Alijah Collins","Breezeway restrooms":"Kathy Phelps","Tropical Birds":"Jada Rawlings","East Admin and restrooms":"Kathy Phelps","West Admin and restrooms":"Kathy Phelps","Courtyard restrooms":"Kathy Phelps","Nocturnal":"Kathy Phelps","Primate Canyon":"Kathy Phelps","Cat House Cafe restrooms":"Jada Rawlings","Herpetarium":"Jada Rawlings","Event Center and restrooms":"Jada Rawlings","Cat Country":"Jada Rawlings","Komodos":"Jada Rawlings","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Kiltra Horton","China and restrooms":"Kiltra Horton","Bonobos restrooms":"Kiltra Horton","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green"},"end":"15:00","zooWideCoverage":false,"points":{"Alijah Collins":36,"Kathy Phelps":29,"Jada Rawlings":28,"Kiltra Horton":23,"Xavier Green":20}},{"start":"15:00","owners":{"Teton and restrooms":"Alijah Collins","Northwest Passage":"Alijah Collins","East End restrooms":"Alijah Collins","Zambezi and restrooms":"Alijah Collins","Primate Pavilion":"Alijah Collins","Breezeway restrooms":"Kiltra Horton","Tropical Birds":"Xavier Green","East Admin and restrooms":"Alijah Collins","West Admin and restrooms":"Kiltra Horton","Courtyard restrooms":"Kiltra Horton","Nocturnal":"Alijah Collins","Primate Canyon":"Alijah Collins","Cat House Cafe restrooms":"Kiltra Horton","Herpetarium":"Xavier Green","Event Center and restrooms":"Xavier Green","Cat Country":"Kiltra Horton","Komodos":"Xavier Green","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Kiltra Horton","China and restrooms":"Kiltra Horton","Bonobos restrooms":"Kiltra Horton","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green"},"end":"16:00","zooWideCoverage":false,"points":{"Alijah Collins":45,"Kiltra Horton":52,"Xavier Green":39}},{"start":"16:00","owners":{"Teton and restrooms":"Xavier Green","Northwest Passage":"Xavier Green","East End restrooms":"Xavier Green","Zambezi and restrooms":"Xavier Green","Primate Pavilion":"Xavier Green","Breezeway restrooms":"Xavier Green","Tropical Birds":"Xavier Green","East Admin and restrooms":"Xavier Green","West Admin and restrooms":"Xavier Green","Courtyard restrooms":"Xavier Green","Nocturnal":"Xavier Green","Primate Canyon":"Xavier Green","Cat House Cafe restrooms":"Xavier Green","Herpetarium":"Xavier Green","Event Center and restrooms":"Xavier Green","Cat Country":"Xavier Green","Komodos":"Xavier Green","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Xavier Green","China and restrooms":"Xavier Green","Bonobos restrooms":"Xavier Green","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green"},"end":"17:00","zooWideCoverage":true,"points":{"Xavier Green":136}}],"checkedWindow":{"start":"08:00","end":"17:00"},"prearrivalPolicy":"UNRESOLVED","policy0945":"OWNER_APPROVED_NO_CHANGEOVER","coveragePurpose":"INHERITED_AREAS_ARE_ALERT_AND_ISSUE_CUSTODY_NOT_EXTRA_MANDATORY_CLEANING"},{"day":"sunday","weekday":0,"sourcePath":"sources/custodial_manual_sunday_working_draft.json","employees":[{"name":"Alijah Collins","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"11:30","end":"12:30"},"baseGroups":["Teton and restrooms","Northwest Passage","East End restrooms"],"basePoints":24},{"name":"Kiltra Horton","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"12:00","end":"13:00"},"baseGroups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds","Nocturnal","Primate Canyon"],"basePoints":27},{"name":"Jada Rawlings","shift":{"start":"06:00","end":"15:00"},"lunch":{"start":"10:00","end":"11:00"},"baseGroups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Education (includes Volunteer, IT, Interpretation, and four classrooms)","Cat Country"],"basePoints":29},{"name":"Derrick Henderson","shift":{"start":"07:00","end":"16:00"},"lunch":{"start":"10:30","end":"11:30"},"baseGroups":["China and restrooms","Bonobos restrooms","Herpetarium","Cat House Cafe restrooms"],"basePoints":27},{"name":"Xavier Green","shift":{"start":"08:00","end":"17:00"},"lunch":{"start":"12:30","end":"13:30"},"baseGroups":["Expo and restrooms","MemMex restrooms","Aquarium","Event Center and restrooms","Komodos"],"basePoints":29}],"lunches":[{"recipient":"Jada Rawlings","coverer":"Kiltra Horton","start":"10:00","end":"11:00","groups":["East Admin and restrooms","West Admin and restrooms","Courtyard restrooms","Education (includes Volunteer, IT, Interpretation, and four classrooms)","Cat Country"],"retainsOwnBase":true},{"recipient":"Derrick Henderson","coverer":"Xavier Green","start":"10:30","end":"11:30","groups":["China and restrooms","Bonobos restrooms","Herpetarium","Cat House Cafe restrooms"],"retainsOwnBase":true},{"recipient":"Alijah Collins","coverer":"Jada Rawlings","start":"11:30","end":"12:30","groups":["Teton and restrooms","Northwest Passage","East End restrooms"],"retainsOwnBase":true},{"recipient":"Kiltra Horton","coverer":"Derrick Henderson","start":"12:00","end":"13:00","groups":["Zambezi and restrooms","Primate Pavilion","Breezeway restrooms","Tropical Birds","Nocturnal","Primate Canyon"],"retainsOwnBase":true},{"recipient":"Xavier Green","coverer":"Jada Rawlings","start":"12:30","end":"13:30","groups":["Expo and restrooms","MemMex restrooms","Aquarium","Event Center and restrooms","Komodos"],"retainsOwnBase":true}],"transfers":[{"time":"15:00","from":"Jada Rawlings","to":"Alijah Collins","group":"East Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Alijah Collins","group":"West Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Kiltra Horton","group":"Education (includes Volunteer, IT, Interpretation, and four classrooms)","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Derrick Henderson","group":"Courtyard restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"15:00","from":"Jada Rawlings","to":"Derrick Henderson","group":"Cat Country","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"Teton and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"Northwest Passage","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"East End restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"East Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Alijah Collins","to":"Xavier Green","group":"West Admin and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Zambezi and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Primate Pavilion","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Breezeway restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Tropical Birds","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Nocturnal","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Primate Canyon","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Kiltra Horton","to":"Xavier Green","group":"Education (includes Volunteer, IT, Interpretation, and four classrooms)","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"China and restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Bonobos restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Herpetarium","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Cat House Cafe restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Courtyard restrooms","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false},{"time":"16:00","from":"Derrick Henderson","to":"Xavier Green","group":"Cat Country","coverage":"INHERITED_ALERTS_AND_ISSUES_ONLY","createsMandatoryCleaningRoute":false}],"phases":[{"start":"08:00","owners":{"Teton and restrooms":"Alijah Collins","Northwest Passage":"Alijah Collins","East End restrooms":"Alijah Collins","Zambezi and restrooms":"Kiltra Horton","Primate Pavilion":"Kiltra Horton","Breezeway restrooms":"Kiltra Horton","Tropical Birds":"Kiltra Horton","Nocturnal":"Kiltra Horton","Primate Canyon":"Kiltra Horton","East Admin and restrooms":"Jada Rawlings","West Admin and restrooms":"Jada Rawlings","Courtyard restrooms":"Jada Rawlings","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Jada Rawlings","Cat Country":"Jada Rawlings","China and restrooms":"Derrick Henderson","Bonobos restrooms":"Derrick Henderson","Herpetarium":"Derrick Henderson","Cat House Cafe restrooms":"Derrick Henderson","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green","Event Center and restrooms":"Xavier Green","Komodos":"Xavier Green"},"end":"15:00","zooWideCoverage":false,"points":{"Alijah Collins":24,"Kiltra Horton":27,"Jada Rawlings":29,"Derrick Henderson":27,"Xavier Green":29}},{"start":"15:00","owners":{"Teton and restrooms":"Alijah Collins","Northwest Passage":"Alijah Collins","East End restrooms":"Alijah Collins","Zambezi and restrooms":"Kiltra Horton","Primate Pavilion":"Kiltra Horton","Breezeway restrooms":"Kiltra Horton","Tropical Birds":"Kiltra Horton","Nocturnal":"Kiltra Horton","Primate Canyon":"Kiltra Horton","East Admin and restrooms":"Alijah Collins","West Admin and restrooms":"Alijah Collins","Courtyard restrooms":"Derrick Henderson","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Kiltra Horton","Cat Country":"Derrick Henderson","China and restrooms":"Derrick Henderson","Bonobos restrooms":"Derrick Henderson","Herpetarium":"Derrick Henderson","Cat House Cafe restrooms":"Derrick Henderson","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green","Event Center and restrooms":"Xavier Green","Komodos":"Xavier Green"},"end":"16:00","zooWideCoverage":false,"points":{"Alijah Collins":36,"Kiltra Horton":35,"Derrick Henderson":36,"Xavier Green":29}},{"start":"16:00","owners":{"Teton and restrooms":"Xavier Green","Northwest Passage":"Xavier Green","East End restrooms":"Xavier Green","Zambezi and restrooms":"Xavier Green","Primate Pavilion":"Xavier Green","Breezeway restrooms":"Xavier Green","Tropical Birds":"Xavier Green","Nocturnal":"Xavier Green","Primate Canyon":"Xavier Green","East Admin and restrooms":"Xavier Green","West Admin and restrooms":"Xavier Green","Courtyard restrooms":"Xavier Green","Education (includes Volunteer, IT, Interpretation, and four classrooms)":"Xavier Green","Cat Country":"Xavier Green","China and restrooms":"Xavier Green","Bonobos restrooms":"Xavier Green","Herpetarium":"Xavier Green","Cat House Cafe restrooms":"Xavier Green","Expo and restrooms":"Xavier Green","MemMex restrooms":"Xavier Green","Aquarium":"Xavier Green","Event Center and restrooms":"Xavier Green","Komodos":"Xavier Green"},"end":"17:00","zooWideCoverage":true,"points":{"Xavier Green":136}}],"checkedWindow":{"start":"08:00","end":"17:00"},"prearrivalPolicy":"UNRESOLVED","policy0945":"OWNER_APPROVED_NO_CHANGEOVER","coveragePurpose":"INHERITED_AREAS_ARE_ALERT_AND_ISSUE_CUSTODY_NOT_EXTRA_MANDATORY_CLEANING"}],"groups":[{"code":"AQUARIUM","name":"Aquarium","points":5,"locationId":"c09dd3a9-808b-4c41-a237-9759a91be3ab"},{"code":"BONOBOS_RESTROOMS","name":"Bonobos restrooms","points":8,"locationId":"d6f8ab36-555b-4a08-8763-272ba37d2b04"},{"code":"BREEZEWAY_RESTROOMS","name":"Breezeway restrooms","points":6,"locationId":"403edde1-f4c5-4c57-8d9d-b2c2703667f4"},{"code":"CAT_COUNTRY","name":"Cat Country","points":2,"locationId":"6bab7a02-7053-4dc3-88b2-784b15e48d4a"},{"code":"CATHOUSE_CAFE_RESTROOMS","name":"Cat House Cafe restrooms","points":7,"locationId":"9eb69196-c103-4a9f-873a-227d32c42ccd"},{"code":"CHINA","name":"China and restrooms","points":7,"locationId":"cde94274-5631-401d-9d57-812e6b47f5ee"},{"code":"COURTYARD_RESTROOMS","name":"Courtyard restrooms","points":7,"locationId":"79edb5d2-e792-4464-9725-780123431dee"},{"code":"EAST_ADMIN","name":"East Admin and restrooms","points":5,"locationId":"7fdde9c1-b334-4adc-ae3e-350ff9419b2b"},{"code":"EAST_END_RESTROOMS","name":"East End restrooms","points":7,"locationId":"72ba55c0-6f64-42dd-a721-98d1717ae350"},{"code":"EDUCATION","name":"Education (includes Volunteer, IT, Interpretation, and four classrooms)","points":8,"locationId":"5933e02f-1dca-4d19-a5c0-e40e5d2f229c"},{"code":"EVENT_CENTER","name":"Event Center and restrooms","points":5,"locationId":"a6ae6887-394a-42e2-b406-8d3c99395be6"},{"code":"EXPO","name":"Expo and restrooms","points":8,"locationId":"81c5cf06-3808-4da9-88d3-408ecc3d9afd"},{"code":"HERPETARIUM","name":"Herpetarium","points":5,"locationId":"7a6ef424-142e-4d0b-9202-8007c3283ae7"},{"code":"KOMODOS","name":"Komodos","points":4,"locationId":"8513ed80-a2da-4eb4-be09-156f62053a05"},{"code":"MEMMEX_RESTROOMS","name":"MemMex restrooms","points":7,"locationId":"8f158d2b-6a2b-4091-9a3a-ed5cf535f627"},{"code":"NOCTURNAL","name":"Nocturnal","points":3,"locationId":"22b1e8d2-e0ba-4ff8-ae4e-3cbe85df27d3"},{"code":"NORTH_WEST_PASSAGE","name":"Northwest Passage","points":7,"locationId":"a92ecadc-c286-47c7-aaad-2550642abedf"},{"code":"PRIMATE_CANYON","name":"Primate Canyon","points":1,"locationId":"0da4b781-f2d2-49c5-af9a-a81e607a85e2"},{"code":"PRIMATE_PAVILLION","name":"Primate Pavilion","points":3,"locationId":"b47d52a4-15aa-4498-be58-cf8a716e8510"},{"code":"TETON","name":"Teton and restrooms","points":10,"locationId":"e127dc20-98ea-4c21-9a8d-5274d29f8508"},{"code":"TROPICAL_BIRDS","name":"Tropical Birds","points":5,"locationId":"d7d70c17-86cd-4f77-be6b-74b4665cfb9c"},{"code":"WEST_ADMIN","name":"West Admin and restrooms","points":7,"locationId":"58418743-10d7-4d22-97f8-1a33d4a969d4"},{"code":"ZAMBEZI","name":"Zambezi and restrooms","points":9,"locationId":"ca8da3d2-57e0-40be-ae23-f06810ca835b"}],"access":{"schema":"custodial.approved-manual-access-proposal.v1","manifestSha256":"fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f","gpsReferenceSha256":"651ee0aeba8266f4f2b591c13ccc0af86b6fd62b815516ad7f5f10a749ac1c42","source":"packet/REQUIREMENTS_EXTRACTED.json:proximity_planning.explicit_directives","directConnections":[["ZAMBEZI","PRIMATE_PAVILLION"],["PRIMATE_PAVILLION","PRIMATE_CANYON"],["TETON","NORTH_WEST_PASSAGE"],["TETON","EAST_END_RESTROOMS"],["NORTH_WEST_PASSAGE","EAST_END_RESTROOMS"],["COURTYARD_RESTROOMS","BREEZEWAY_RESTROOMS"],["BREEZEWAY_RESTROOMS","EDUCATION"],["BONOBOS_RESTROOMS","CATHOUSE_CAFE_RESTROOMS"]],"neighborhoods":[["ZAMBEZI","PRIMATE_PAVILLION","PRIMATE_CANYON","BREEZEWAY_RESTROOMS"],["PRIMATE_CANYON","CHINA","BONOBOS_RESTROOMS"],["COURTYARD_RESTROOMS","BREEZEWAY_RESTROOMS","EDUCATION","NOCTURNAL","CATHOUSE_CAFE_RESTROOMS","CAT_COUNTRY","PRIMATE_CANYON"],["HERPETARIUM","EVENT_CENTER","BONOBOS_RESTROOMS","CHINA","PRIMATE_CANYON"],["CATHOUSE_CAFE_RESTROOMS","TROPICAL_BIRDS","HERPETARIUM","EVENT_CENTER","KOMODOS"],["HERPETARIUM","EVENT_CENTER","KOMODOS","AQUARIUM"],["HERPETARIUM","KOMODOS","AQUARIUM","EXPO","MEMMEX_RESTROOMS"],["TROPICAL_BIRDS","MEMMEX_RESTROOMS","EXPO","AQUARIUM"]],"pairs":[{"from":"AQUARIUM","to":"BONOBOS_RESTROOMS","meters":257.004111927322,"accessFactor":1,"accessPenaltyMeters":257.004111927322,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"BREEZEWAY_RESTROOMS","meters":311.7026799488406,"accessFactor":1,"accessPenaltyMeters":311.7026799488406,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"CAT_COUNTRY","meters":244.88901783393726,"accessFactor":1,"accessPenaltyMeters":244.88901783393726,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"CATHOUSE_CAFE_RESTROOMS","meters":261.022480269194,"accessFactor":1,"accessPenaltyMeters":261.022480269194,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"CHINA","meters":305.21043399761356,"accessFactor":1,"accessPenaltyMeters":305.21043399761356,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"COURTYARD_RESTROOMS","meters":298.86945592017713,"accessFactor":1,"accessPenaltyMeters":298.86945592017713,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"EAST_ADMIN","meters":324.1012486521421,"accessFactor":1,"accessPenaltyMeters":324.1012486521421,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"EAST_END_RESTROOMS","meters":629.8890004253901,"accessFactor":1,"accessPenaltyMeters":629.8890004253901,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"EDUCATION","meters":311.7026799488406,"accessFactor":1,"accessPenaltyMeters":311.7026799488406,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"EVENT_CENTER","meters":207.7444749876901,"accessFactor":0.9,"accessPenaltyMeters":186.9700274889211,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"AQUARIUM","to":"EXPO","meters":72.72571910300128,"accessFactor":0.9,"accessPenaltyMeters":65.45314719270115,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"AQUARIUM","to":"HERPETARIUM","meters":188.82264413738795,"accessFactor":0.9,"accessPenaltyMeters":169.94037972364916,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"AQUARIUM","to":"KOMODOS","meters":172.0143887760625,"accessFactor":0.9,"accessPenaltyMeters":154.81294989845625,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"AQUARIUM","to":"MEMMEX_RESTROOMS","meters":106.1818567997055,"accessFactor":0.9,"accessPenaltyMeters":95.56367111973495,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"AQUARIUM","to":"NOCTURNAL","meters":286.74196393773764,"accessFactor":1,"accessPenaltyMeters":286.74196393773764,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"NORTH_WEST_PASSAGE","meters":712.1775186773023,"accessFactor":1,"accessPenaltyMeters":712.1775186773023,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"PRIMATE_CANYON","meters":319.01404359327125,"accessFactor":1,"accessPenaltyMeters":319.01404359327125,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"PRIMATE_PAVILLION","meters":437.3667363814047,"accessFactor":1,"accessPenaltyMeters":437.3667363814047,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"TETON","meters":807.6262463035904,"accessFactor":1,"accessPenaltyMeters":807.6262463035904,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"TROPICAL_BIRDS","meters":183.1939007304591,"accessFactor":0.9,"accessPenaltyMeters":164.8745106574132,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"AQUARIUM","to":"WEST_ADMIN","meters":315.6230106680201,"accessFactor":1,"accessPenaltyMeters":315.6230106680201,"accessBasis":"GPS_BASELINE"},{"from":"AQUARIUM","to":"ZAMBEZI","meters":447.1331160827563,"accessFactor":1,"accessPenaltyMeters":447.1331160827563,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"BREEZEWAY_RESTROOMS","meters":97.97446535067661,"accessFactor":1,"accessPenaltyMeters":97.97446535067661,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"CAT_COUNTRY","meters":127.22341971151191,"accessFactor":1,"accessPenaltyMeters":127.22341971151191,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"CATHOUSE_CAFE_RESTROOMS","meters":74.60607691833864,"accessFactor":0.8,"accessPenaltyMeters":59.684861534670915,"accessBasis":"EXPLICIT_SAVED_CONNECTION"},{"from":"BONOBOS_RESTROOMS","to":"CHINA","meters":48.28789955688835,"accessFactor":0.9,"accessPenaltyMeters":43.459109601199515,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"BONOBOS_RESTROOMS","to":"COURTYARD_RESTROOMS","meters":140.0911401332584,"accessFactor":1,"accessPenaltyMeters":140.0911401332584,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"EAST_ADMIN","meters":147.03047060618735,"accessFactor":1,"accessPenaltyMeters":147.03047060618735,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"EAST_END_RESTROOMS","meters":373.0587064180441,"accessFactor":1,"accessPenaltyMeters":373.0587064180441,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"EDUCATION","meters":97.97446535067661,"accessFactor":1,"accessPenaltyMeters":97.97446535067661,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"EVENT_CENTER","meters":49.38423350740313,"accessFactor":0.9,"accessPenaltyMeters":44.445810156662816,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"BONOBOS_RESTROOMS","to":"EXPO","meters":260.6168058521447,"accessFactor":1,"accessPenaltyMeters":260.6168058521447,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"HERPETARIUM","meters":72.88760050848681,"accessFactor":0.9,"accessPenaltyMeters":65.59884045763813,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"BONOBOS_RESTROOMS","to":"KOMODOS","meters":93.42570568275852,"accessFactor":1,"accessPenaltyMeters":93.42570568275852,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"MEMMEX_RESTROOMS","meters":225.18317973846476,"accessFactor":1,"accessPenaltyMeters":225.18317973846476,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"NOCTURNAL","meters":64.86197652101218,"accessFactor":1,"accessPenaltyMeters":64.86197652101218,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"NORTH_WEST_PASSAGE","meters":455.21261039082054,"accessFactor":1,"accessPenaltyMeters":455.21261039082054,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"PRIMATE_CANYON","meters":66.93608236549974,"accessFactor":0.9,"accessPenaltyMeters":60.24247412894977,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"BONOBOS_RESTROOMS","to":"PRIMATE_PAVILLION","meters":186.04355117405305,"accessFactor":1,"accessPenaltyMeters":186.04355117405305,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"TETON","meters":554.5444771863981,"accessFactor":1,"accessPenaltyMeters":554.5444771863981,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"TROPICAL_BIRDS","meters":153.3261126761712,"accessFactor":1,"accessPenaltyMeters":153.3261126761712,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"WEST_ADMIN","meters":161.68402737736082,"accessFactor":1,"accessPenaltyMeters":161.68402737736082,"accessBasis":"GPS_BASELINE"},{"from":"BONOBOS_RESTROOMS","to":"ZAMBEZI","meters":214.40929757403515,"accessFactor":1,"accessPenaltyMeters":214.40929757403515,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"CAT_COUNTRY","meters":90.64116456468146,"accessFactor":0.9,"accessPenaltyMeters":81.57704810821332,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"BREEZEWAY_RESTROOMS","to":"CATHOUSE_CAFE_RESTROOMS","meters":50.680361028353985,"accessFactor":0.9,"accessPenaltyMeters":45.612324925518585,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"BREEZEWAY_RESTROOMS","to":"CHINA","meters":91.86603152853112,"accessFactor":1,"accessPenaltyMeters":91.86603152853112,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"COURTYARD_RESTROOMS","meters":61.98056921055859,"accessFactor":0.8,"accessPenaltyMeters":49.584455368446875,"accessBasis":"EXPLICIT_SAVED_CONNECTION"},{"from":"BREEZEWAY_RESTROOMS","to":"EAST_ADMIN","meters":55.09476402594937,"accessFactor":1,"accessPenaltyMeters":55.09476402594937,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"EAST_END_RESTROOMS","meters":347.4832582621281,"accessFactor":1,"accessPenaltyMeters":347.4832582621281,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"EDUCATION","meters":0,"accessFactor":0.8,"accessPenaltyMeters":0,"accessBasis":"EXPLICIT_SAVED_CONNECTION"},{"from":"BREEZEWAY_RESTROOMS","to":"EVENT_CENTER","meters":124.91537376122744,"accessFactor":1,"accessPenaltyMeters":124.91537376122744,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"EXPO","meters":292.6439644289392,"accessFactor":1,"accessPenaltyMeters":292.6439644289392,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"HERPETARIUM","meters":129.68957935791545,"accessFactor":1,"accessPenaltyMeters":129.68957935791545,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"KOMODOS","meters":176.87466720919656,"accessFactor":1,"accessPenaltyMeters":176.87466720919656,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"MEMMEX_RESTROOMS","meters":247.09721364160384,"accessFactor":1,"accessPenaltyMeters":247.09721364160384,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"NOCTURNAL","meters":33.63754310973425,"accessFactor":0.9,"accessPenaltyMeters":30.27378879876083,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"BREEZEWAY_RESTROOMS","to":"NORTH_WEST_PASSAGE","meters":420.67598536225546,"accessFactor":1,"accessPenaltyMeters":420.67598536225546,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"PRIMATE_CANYON","meters":63.42718269419478,"accessFactor":0.9,"accessPenaltyMeters":57.0844644247753,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"BREEZEWAY_RESTROOMS","to":"PRIMATE_PAVILLION","meters":137.60439665597158,"accessFactor":0.9,"accessPenaltyMeters":123.84395699037442,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"BREEZEWAY_RESTROOMS","to":"TETON","meters":501.11695372347896,"accessFactor":1,"accessPenaltyMeters":501.11695372347896,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"TROPICAL_BIRDS","meters":152.02189623084715,"accessFactor":1,"accessPenaltyMeters":152.02189623084715,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"WEST_ADMIN","meters":77.45629001637936,"accessFactor":1,"accessPenaltyMeters":77.45629001637936,"accessBasis":"GPS_BASELINE"},{"from":"BREEZEWAY_RESTROOMS","to":"ZAMBEZI","meters":135.44450459663543,"accessFactor":0.9,"accessPenaltyMeters":121.90005413697189,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CAT_COUNTRY","to":"CATHOUSE_CAFE_RESTROOMS","meters":58.218761179322236,"accessFactor":0.9,"accessPenaltyMeters":52.396885061390016,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CAT_COUNTRY","to":"CHINA","meters":153.049528932374,"accessFactor":1,"accessPenaltyMeters":153.049528932374,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"COURTYARD_RESTROOMS","meters":54.34276748638329,"accessFactor":0.9,"accessPenaltyMeters":48.90849073774496,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CAT_COUNTRY","to":"EAST_ADMIN","meters":80.6099991177304,"accessFactor":1,"accessPenaltyMeters":80.6099991177304,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"EAST_END_RESTROOMS","meters":438.0720024815665,"accessFactor":1,"accessPenaltyMeters":438.0720024815665,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"EDUCATION","meters":90.64116456468146,"accessFactor":0.9,"accessPenaltyMeters":81.57704810821332,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CAT_COUNTRY","to":"EVENT_CENTER","meters":116.62210534754105,"accessFactor":1,"accessPenaltyMeters":116.62210534754105,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"EXPO","meters":212.34583744648936,"accessFactor":1,"accessPenaltyMeters":212.34583744648936,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"HERPETARIUM","meters":101.0182185654753,"accessFactor":1,"accessPenaltyMeters":101.0182185654753,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"KOMODOS","meters":157.66464128798026,"accessFactor":1,"accessPenaltyMeters":157.66464128798026,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"MEMMEX_RESTROOMS","meters":164.12300912204893,"accessFactor":1,"accessPenaltyMeters":164.12300912204893,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"NOCTURNAL","meters":89.02154049815448,"accessFactor":0.9,"accessPenaltyMeters":80.11938644833903,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CAT_COUNTRY","to":"NORTH_WEST_PASSAGE","meters":510.3472924355067,"accessFactor":1,"accessPenaltyMeters":510.3472924355067,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"PRIMATE_CANYON","meters":138.63700727545265,"accessFactor":0.9,"accessPenaltyMeters":124.77330654790738,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CAT_COUNTRY","to":"PRIMATE_PAVILLION","meters":227.74388903740098,"accessFactor":1,"accessPenaltyMeters":227.74388903740098,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"TETON","meters":585.5164579925811,"accessFactor":1,"accessPenaltyMeters":585.5164579925811,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"TROPICAL_BIRDS","meters":66.66980592695452,"accessFactor":1,"accessPenaltyMeters":66.66980592695452,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"WEST_ADMIN","meters":71.07746619560888,"accessFactor":1,"accessPenaltyMeters":71.07746619560888,"accessBasis":"GPS_BASELINE"},{"from":"CAT_COUNTRY","to":"ZAMBEZI","meters":214.55798217855684,"accessFactor":1,"accessPenaltyMeters":214.55798217855684,"accessBasis":"GPS_BASELINE"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"CHINA","meters":94.89721133761815,"accessFactor":1,"accessPenaltyMeters":94.89721133761815,"accessBasis":"GPS_BASELINE"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"COURTYARD_RESTROOMS","meters":67.06450100755605,"accessFactor":0.9,"accessPenaltyMeters":60.35805090680044,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"EAST_ADMIN","meters":79.87082689965402,"accessFactor":1,"accessPenaltyMeters":79.87082689965402,"accessBasis":"GPS_BASELINE"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"EAST_END_RESTROOMS","meters":390.4351840007441,"accessFactor":1,"accessPenaltyMeters":390.4351840007441,"accessBasis":"GPS_BASELINE"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"EDUCATION","meters":50.680361028353985,"accessFactor":0.9,"accessPenaltyMeters":45.612324925518585,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"EVENT_CENTER","meters":82.87540084222886,"accessFactor":0.9,"accessPenaltyMeters":74.58786075800597,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"EXPO","meters":243.58068136905638,"accessFactor":1,"accessPenaltyMeters":243.58068136905638,"accessBasis":"GPS_BASELINE"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"HERPETARIUM","meters":81.61249037370736,"accessFactor":0.9,"accessPenaltyMeters":73.45124133633662,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"KOMODOS","meters":133.41146184234546,"accessFactor":0.9,"accessPenaltyMeters":120.07031565811091,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"MEMMEX_RESTROOMS","meters":199.29076067102406,"accessFactor":1,"accessPenaltyMeters":199.29076067102406,"accessBasis":"GPS_BASELINE"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"NOCTURNAL","meters":33.050612202216314,"accessFactor":0.9,"accessPenaltyMeters":29.745550981994683,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"NORTH_WEST_PASSAGE","meters":466.34443602712827,"accessFactor":1,"accessPenaltyMeters":466.34443602712827,"accessBasis":"GPS_BASELINE"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"PRIMATE_CANYON","meters":81.86585235182227,"accessFactor":0.9,"accessPenaltyMeters":73.67926711664005,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"PRIMATE_PAVILLION","meters":183.69873468737322,"accessFactor":1,"accessPenaltyMeters":183.69873468737322,"accessBasis":"GPS_BASELINE"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"TETON","meters":550.5804895571487,"accessFactor":1,"accessPenaltyMeters":550.5804895571487,"accessBasis":"GPS_BASELINE"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"TROPICAL_BIRDS","meters":107.54816882623973,"accessFactor":0.9,"accessPenaltyMeters":96.79335194361576,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"WEST_ADMIN","meters":89.298917906417,"accessFactor":1,"accessPenaltyMeters":89.298917906417,"accessBasis":"GPS_BASELINE"},{"from":"CATHOUSE_CAFE_RESTROOMS","to":"ZAMBEZI","meters":186.11780189868173,"accessFactor":1,"accessPenaltyMeters":186.11780189868173,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"COURTYARD_RESTROOMS","meters":148.7584361749359,"accessFactor":1,"accessPenaltyMeters":148.7584361749359,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"EAST_ADMIN","meters":146.85756541649778,"accessFactor":1,"accessPenaltyMeters":146.85756541649778,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"EAST_END_RESTROOMS","meters":324.7775230028438,"accessFactor":1,"accessPenaltyMeters":324.7775230028438,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"EDUCATION","meters":91.86603152853112,"accessFactor":1,"accessPenaltyMeters":91.86603152853112,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"EVENT_CENTER","meters":97.67212991984556,"accessFactor":0.9,"accessPenaltyMeters":87.90491692786101,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CHINA","to":"EXPO","meters":307.93693944002786,"accessFactor":1,"accessPenaltyMeters":307.93693944002786,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"HERPETARIUM","meters":120.31249396125546,"accessFactor":0.9,"accessPenaltyMeters":108.28124456512991,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CHINA","to":"KOMODOS","meters":139.07024763527062,"accessFactor":1,"accessPenaltyMeters":139.07024763527062,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"MEMMEX_RESTROOMS","meters":270.89738715563914,"accessFactor":1,"accessPenaltyMeters":270.89738715563914,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"NOCTURNAL","meters":68.30713559280396,"accessFactor":1,"accessPenaltyMeters":68.30713559280396,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"NORTH_WEST_PASSAGE","meters":407.1206389400806,"accessFactor":1,"accessPenaltyMeters":407.1206389400806,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"PRIMATE_CANYON","meters":33.55838030490072,"accessFactor":0.9,"accessPenaltyMeters":30.20254227441065,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"CHINA","to":"PRIMATE_PAVILLION","meters":142.52585499143,"accessFactor":1,"accessPenaltyMeters":142.52585499143,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"TETON","meters":508.23801969216873,"accessFactor":1,"accessPenaltyMeters":508.23801969216873,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"TROPICAL_BIRDS","meters":192.35624730630792,"accessFactor":1,"accessPenaltyMeters":192.35624730630792,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"WEST_ADMIN","meters":167.52880332919509,"accessFactor":1,"accessPenaltyMeters":167.52880332919509,"accessBasis":"GPS_BASELINE"},{"from":"CHINA","to":"ZAMBEZI","meters":180.58410044340724,"accessFactor":1,"accessPenaltyMeters":180.58410044340724,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"EAST_ADMIN","meters":26.89318744860133,"accessFactor":1,"accessPenaltyMeters":26.89318744860133,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"EAST_END_RESTROOMS","meters":398.1196110537417,"accessFactor":1,"accessPenaltyMeters":398.1196110537417,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"EDUCATION","meters":61.98056921055859,"accessFactor":0.9,"accessPenaltyMeters":55.78251228950273,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"COURTYARD_RESTROOMS","to":"EVENT_CENTER","meters":147.92424941144975,"accessFactor":1,"accessPenaltyMeters":147.92424941144975,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"EXPO","meters":266.1457620170777,"accessFactor":1,"accessPenaltyMeters":266.1457620170777,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"HERPETARIUM","meters":140.5502702998514,"accessFactor":1,"accessPenaltyMeters":140.5502702998514,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"KOMODOS","meters":196.0732808302883,"accessFactor":1,"accessPenaltyMeters":196.0732808302883,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"MEMMEX_RESTROOMS","meters":217.49871167512043,"accessFactor":1,"accessPenaltyMeters":217.49871167512043,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"NOCTURNAL","meters":81.00104998248855,"accessFactor":0.9,"accessPenaltyMeters":72.9009449842397,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"COURTYARD_RESTROOMS","to":"NORTH_WEST_PASSAGE","meters":466.48087397883535,"accessFactor":1,"accessPenaltyMeters":466.48087397883535,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"PRIMATE_CANYON","meters":124.07250449752162,"accessFactor":0.9,"accessPenaltyMeters":111.66525404776947,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"COURTYARD_RESTROOMS","to":"PRIMATE_PAVILLION","meters":187.40468997235476,"accessFactor":1,"accessPenaltyMeters":187.40468997235476,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"TETON","meters":535.6107524418265,"accessFactor":1,"accessPenaltyMeters":535.6107524418265,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"TROPICAL_BIRDS","meters":120.37980483815592,"accessFactor":1,"accessPenaltyMeters":120.37980483815592,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"WEST_ADMIN","meters":22.36857958471583,"accessFactor":1,"accessPenaltyMeters":22.36857958471583,"accessBasis":"GPS_BASELINE"},{"from":"COURTYARD_RESTROOMS","to":"ZAMBEZI","meters":164.26770706974088,"accessFactor":1,"accessPenaltyMeters":164.26770706974088,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"EAST_END_RESTROOMS","meters":375.1043654734762,"accessFactor":1,"accessPenaltyMeters":375.1043654734762,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"EDUCATION","meters":55.09476402594937,"accessFactor":1,"accessPenaltyMeters":55.09476402594937,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"EVENT_CENTER","meters":162.7455838603921,"accessFactor":1,"accessPenaltyMeters":162.7455838603921,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"EXPO","meters":292.8073302313168,"accessFactor":1,"accessPenaltyMeters":292.8073302313168,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"HERPETARIUM","meters":159.11308227144238,"accessFactor":1,"accessPenaltyMeters":159.11308227144238,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"KOMODOS","meters":212.91746278849078,"accessFactor":1,"accessPenaltyMeters":212.91746278849078,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"MEMMEX_RESTROOMS","meters":244.27174557131767,"accessFactor":1,"accessPenaltyMeters":244.27174557131767,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"NOCTURNAL","meters":83.21861914156709,"accessFactor":1,"accessPenaltyMeters":83.21861914156709,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"NORTH_WEST_PASSAGE","meters":441.8450846047211,"accessFactor":1,"accessPenaltyMeters":441.8450846047211,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"PRIMATE_CANYON","meters":118.16109893452689,"accessFactor":1,"accessPenaltyMeters":118.16109893452689,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"PRIMATE_PAVILLION","meters":165.28296186298448,"accessFactor":1,"accessPenaltyMeters":165.28296186298448,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"TETON","meters":509.0903654805302,"accessFactor":1,"accessPenaltyMeters":509.0903654805302,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"TROPICAL_BIRDS","meters":147.02365291443957,"accessFactor":1,"accessPenaltyMeters":147.02365291443957,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"WEST_ADMIN","meters":26.391842285513583,"accessFactor":1,"accessPenaltyMeters":26.391842285513583,"accessBasis":"GPS_BASELINE"},{"from":"EAST_ADMIN","to":"ZAMBEZI","meters":137.9110822304892,"accessFactor":1,"accessPenaltyMeters":137.9110822304892,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"EDUCATION","meters":347.4832582621281,"accessFactor":1,"accessPenaltyMeters":347.4832582621281,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"EVENT_CENTER","meters":422.4373092416116,"accessFactor":1,"accessPenaltyMeters":422.4373092416116,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"EXPO","meters":629.4875888453029,"accessFactor":1,"accessPenaltyMeters":629.4875888453029,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"HERPETARIUM","meters":443.9000316577989,"accessFactor":1,"accessPenaltyMeters":443.9000316577989,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"KOMODOS","meters":460.75663066313615,"accessFactor":1,"accessPenaltyMeters":460.75663066313615,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"MEMMEX_RESTROOMS","meters":588.3256437662415,"accessFactor":1,"accessPenaltyMeters":588.3256437662415,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"NOCTURNAL","meters":358.04084419943996,"accessFactor":1,"accessPenaltyMeters":358.04084419943996,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"NORTH_WEST_PASSAGE","meters":87.02097181198371,"accessFactor":0.8,"accessPenaltyMeters":69.61677744958698,"accessBasis":"EXPLICIT_SAVED_CONNECTION"},{"from":"EAST_END_RESTROOMS","to":"PRIMATE_CANYON","meters":315.2148931645013,"accessFactor":1,"accessPenaltyMeters":315.2148931645013,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"PRIMATE_PAVILLION","meters":210.95461519396002,"accessFactor":1,"accessPenaltyMeters":210.95461519396002,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"TETON","meters":216.25866363286238,"accessFactor":0.8,"accessPenaltyMeters":173.0069309062899,"accessBasis":"EXPLICIT_SAVED_CONNECTION"},{"from":"EAST_END_RESTROOMS","to":"TROPICAL_BIRDS","meters":497.7174361060428,"accessFactor":1,"accessPenaltyMeters":497.7174361060428,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"WEST_ADMIN","meters":400.36198800392134,"accessFactor":1,"accessPenaltyMeters":400.36198800392134,"accessBasis":"GPS_BASELINE"},{"from":"EAST_END_RESTROOMS","to":"ZAMBEZI","meters":249.59805643413895,"accessFactor":1,"accessPenaltyMeters":249.59805643413895,"accessBasis":"GPS_BASELINE"},{"from":"EDUCATION","to":"EVENT_CENTER","meters":124.91537376122744,"accessFactor":1,"accessPenaltyMeters":124.91537376122744,"accessBasis":"GPS_BASELINE"},{"from":"EDUCATION","to":"EXPO","meters":292.6439644289392,"accessFactor":1,"accessPenaltyMeters":292.6439644289392,"accessBasis":"GPS_BASELINE"},{"from":"EDUCATION","to":"HERPETARIUM","meters":129.68957935791545,"accessFactor":1,"accessPenaltyMeters":129.68957935791545,"accessBasis":"GPS_BASELINE"},{"from":"EDUCATION","to":"KOMODOS","meters":176.87466720919656,"accessFactor":1,"accessPenaltyMeters":176.87466720919656,"accessBasis":"GPS_BASELINE"},{"from":"EDUCATION","to":"MEMMEX_RESTROOMS","meters":247.09721364160384,"accessFactor":1,"accessPenaltyMeters":247.09721364160384,"accessBasis":"GPS_BASELINE"},{"from":"EDUCATION","to":"NOCTURNAL","meters":33.63754310973425,"accessFactor":0.9,"accessPenaltyMeters":30.27378879876083,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"EDUCATION","to":"NORTH_WEST_PASSAGE","meters":420.67598536225546,"accessFactor":1,"accessPenaltyMeters":420.67598536225546,"accessBasis":"GPS_BASELINE"},{"from":"EDUCATION","to":"PRIMATE_CANYON","meters":63.42718269419478,"accessFactor":0.9,"accessPenaltyMeters":57.0844644247753,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"EDUCATION","to":"PRIMATE_PAVILLION","meters":137.60439665597158,"accessFactor":1,"accessPenaltyMeters":137.60439665597158,"accessBasis":"GPS_BASELINE"},{"from":"EDUCATION","to":"TETON","meters":501.11695372347896,"accessFactor":1,"accessPenaltyMeters":501.11695372347896,"accessBasis":"GPS_BASELINE"},{"from":"EDUCATION","to":"TROPICAL_BIRDS","meters":152.02189623084715,"accessFactor":1,"accessPenaltyMeters":152.02189623084715,"accessBasis":"GPS_BASELINE"},{"from":"EDUCATION","to":"WEST_ADMIN","meters":77.45629001637936,"accessFactor":1,"accessPenaltyMeters":77.45629001637936,"accessBasis":"GPS_BASELINE"},{"from":"EDUCATION","to":"ZAMBEZI","meters":135.44450459663543,"accessFactor":1,"accessPenaltyMeters":135.44450459663543,"accessBasis":"GPS_BASELINE"},{"from":"EVENT_CENTER","to":"EXPO","meters":212.66613791912852,"accessFactor":1,"accessPenaltyMeters":212.66613791912852,"accessBasis":"GPS_BASELINE"},{"from":"EVENT_CENTER","to":"HERPETARIUM","meters":27.652558020623893,"accessFactor":0.9,"accessPenaltyMeters":24.887302218561505,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"EVENT_CENTER","to":"KOMODOS","meters":51.967065132479206,"accessFactor":0.9,"accessPenaltyMeters":46.77035861923129,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"EVENT_CENTER","to":"MEMMEX_RESTROOMS","meters":179.81694103476158,"accessFactor":1,"accessPenaltyMeters":179.81694103476158,"accessBasis":"GPS_BASELINE"},{"from":"EVENT_CENTER","to":"NOCTURNAL","meters":92.51070947277358,"accessFactor":1,"accessPenaltyMeters":92.51070947277358,"accessBasis":"GPS_BASELINE"},{"from":"EVENT_CENTER","to":"NORTH_WEST_PASSAGE","meters":504.4332578101666,"accessFactor":1,"accessPenaltyMeters":504.4332578101666,"accessBasis":"GPS_BASELINE"},{"from":"EVENT_CENTER","to":"PRIMATE_CANYON","meters":112.83942386448523,"accessFactor":0.9,"accessPenaltyMeters":101.55548147803671,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"EVENT_CENTER","to":"PRIMATE_PAVILLION","meters":232.498073622756,"accessFactor":1,"accessPenaltyMeters":232.498073622756,"accessBasis":"GPS_BASELINE"},{"from":"EVENT_CENTER","to":"TETON","meters":602.2180129592856,"accessFactor":1,"accessPenaltyMeters":602.2180129592856,"accessBasis":"GPS_BASELINE"},{"from":"EVENT_CENTER","to":"TROPICAL_BIRDS","meters":120.53612201586888,"accessFactor":0.9,"accessPenaltyMeters":108.482509814282,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"EVENT_CENTER","to":"WEST_ADMIN","meters":170.26222150526888,"accessFactor":1,"accessPenaltyMeters":170.26222150526888,"accessBasis":"GPS_BASELINE"},{"from":"EVENT_CENTER","to":"ZAMBEZI","meters":253.87372653446806,"accessFactor":1,"accessPenaltyMeters":253.87372653446806,"accessBasis":"GPS_BASELINE"},{"from":"EXPO","to":"HERPETARIUM","meters":187.7626483480702,"accessFactor":0.9,"accessPenaltyMeters":168.98638351326318,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"EXPO","to":"KOMODOS","meters":192.88888516407195,"accessFactor":0.9,"accessPenaltyMeters":173.59999664766477,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"EXPO","to":"MEMMEX_RESTROOMS","meters":49.47943733871161,"accessFactor":0.9,"accessPenaltyMeters":44.53149360484045,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"EXPO","to":"NOCTURNAL","meters":273.88360423952054,"accessFactor":1,"accessPenaltyMeters":273.88360423952054,"accessBasis":"GPS_BASELINE"},{"from":"EXPO","to":"NORTH_WEST_PASSAGE","meters":708.2174811290038,"accessFactor":1,"accessPenaltyMeters":708.2174811290038,"accessBasis":"GPS_BASELINE"},{"from":"EXPO","to":"PRIMATE_CANYON","meters":314.27422629080576,"accessFactor":1,"accessPenaltyMeters":314.27422629080576,"accessBasis":"GPS_BASELINE"},{"from":"EXPO","to":"PRIMATE_PAVILLION","meters":426.86471207740277,"accessFactor":1,"accessPenaltyMeters":426.86471207740277,"accessBasis":"GPS_BASELINE"},{"from":"EXPO","to":"TETON","meters":793.7609115822203,"accessFactor":1,"accessPenaltyMeters":793.7609115822203,"accessBasis":"GPS_BASELINE"},{"from":"EXPO","to":"TROPICAL_BIRDS","meters":145.78423847241064,"accessFactor":0.9,"accessPenaltyMeters":131.20581462516958,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"EXPO","to":"WEST_ADMIN","meters":279.2324654095386,"accessFactor":1,"accessPenaltyMeters":279.2324654095386,"accessBasis":"GPS_BASELINE"},{"from":"EXPO","to":"ZAMBEZI","meters":425.19641400546874,"accessFactor":1,"accessPenaltyMeters":425.19641400546874,"accessBasis":"GPS_BASELINE"},{"from":"HERPETARIUM","to":"KOMODOS","meters":56.73350680626607,"accessFactor":0.9,"accessPenaltyMeters":51.060156125639466,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"HERPETARIUM","to":"MEMMEX_RESTROOMS","meters":153.03018933764423,"accessFactor":0.9,"accessPenaltyMeters":137.72717040387982,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"HERPETARIUM","to":"NOCTURNAL","meters":100.41811438880997,"accessFactor":1,"accessPenaltyMeters":100.41811438880997,"accessBasis":"GPS_BASELINE"},{"from":"HERPETARIUM","to":"NORTH_WEST_PASSAGE","meters":524.7166323122547,"accessFactor":1,"accessPenaltyMeters":524.7166323122547,"accessBasis":"GPS_BASELINE"},{"from":"HERPETARIUM","to":"PRIMATE_CANYON","meters":130.38555266822863,"accessFactor":0.9,"accessPenaltyMeters":117.34699740140577,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"HERPETARIUM","to":"PRIMATE_PAVILLION","meters":248.6050471186126,"accessFactor":1,"accessPenaltyMeters":248.6050471186126,"accessBasis":"GPS_BASELINE"},{"from":"HERPETARIUM","to":"TETON","meters":618.8975220846683,"accessFactor":1,"accessPenaltyMeters":618.8975220846683,"accessBasis":"GPS_BASELINE"},{"from":"HERPETARIUM","to":"TROPICAL_BIRDS","meters":94.47966780681524,"accessFactor":0.9,"accessPenaltyMeters":85.03170102613372,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"HERPETARIUM","to":"WEST_ADMIN","meters":162.35912008720058,"accessFactor":1,"accessPenaltyMeters":162.35912008720058,"accessBasis":"GPS_BASELINE"},{"from":"HERPETARIUM","to":"ZAMBEZI","meters":263.3326921541501,"accessFactor":1,"accessPenaltyMeters":263.3326921541501,"accessBasis":"GPS_BASELINE"},{"from":"KOMODOS","to":"MEMMEX_RESTROOMS","meters":170.91012293230295,"accessFactor":0.9,"accessPenaltyMeters":153.81911063907268,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"KOMODOS","to":"NOCTURNAL","meters":144.41093910560278,"accessFactor":1,"accessPenaltyMeters":144.41093910560278,"accessBasis":"GPS_BASELINE"},{"from":"KOMODOS","to":"NORTH_WEST_PASSAGE","meters":544.6090682010657,"accessFactor":1,"accessPenaltyMeters":544.6090682010657,"accessBasis":"GPS_BASELINE"},{"from":"KOMODOS","to":"PRIMATE_CANYON","meters":160.21300517760437,"accessFactor":1,"accessPenaltyMeters":160.21300517760437,"accessBasis":"GPS_BASELINE"},{"from":"KOMODOS","to":"PRIMATE_PAVILLION","meters":279.4565263252229,"accessFactor":1,"accessPenaltyMeters":279.4565263252229,"accessBasis":"GPS_BASELINE"},{"from":"KOMODOS","to":"TETON","meters":647.2573350309109,"accessFactor":1,"accessPenaltyMeters":647.2573350309109,"accessBasis":"GPS_BASELINE"},{"from":"KOMODOS","to":"TROPICAL_BIRDS","meters":141.06579610513595,"accessFactor":0.9,"accessPenaltyMeters":126.95921649462235,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"KOMODOS","to":"WEST_ADMIN","meters":218.14883674239326,"accessFactor":1,"accessPenaltyMeters":218.14883674239326,"accessBasis":"GPS_BASELINE"},{"from":"KOMODOS","to":"ZAMBEZI","meters":304.86901090693385,"accessFactor":1,"accessPenaltyMeters":304.86901090693385,"accessBasis":"GPS_BASELINE"},{"from":"MEMMEX_RESTROOMS","to":"NOCTURNAL","meters":230.74340107779145,"accessFactor":1,"accessPenaltyMeters":230.74340107779145,"accessBasis":"GPS_BASELINE"},{"from":"MEMMEX_RESTROOMS","to":"NORTH_WEST_PASSAGE","meters":665.4876367883281,"accessFactor":1,"accessPenaltyMeters":665.4876367883281,"accessBasis":"GPS_BASELINE"},{"from":"MEMMEX_RESTROOMS","to":"PRIMATE_CANYON","meters":273.73538371037904,"accessFactor":1,"accessPenaltyMeters":273.73538371037904,"accessBasis":"GPS_BASELINE"},{"from":"MEMMEX_RESTROOMS","to":"PRIMATE_PAVILLION","meters":382.98354177722115,"accessFactor":1,"accessPenaltyMeters":382.98354177722115,"accessBasis":"GPS_BASELINE"},{"from":"MEMMEX_RESTROOMS","to":"TETON","meters":747.7832286118311,"accessFactor":1,"accessPenaltyMeters":747.7832286118311,"accessBasis":"GPS_BASELINE"},{"from":"MEMMEX_RESTROOMS","to":"TROPICAL_BIRDS","meters":97.46150252032129,"accessFactor":0.9,"accessPenaltyMeters":87.71535226828917,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"MEMMEX_RESTROOMS","to":"WEST_ADMIN","meters":230.04903262871892,"accessFactor":1,"accessPenaltyMeters":230.04903262871892,"accessBasis":"GPS_BASELINE"},{"from":"MEMMEX_RESTROOMS","to":"ZAMBEZI","meters":378.0164059494047,"accessFactor":1,"accessPenaltyMeters":378.0164059494047,"accessBasis":"GPS_BASELINE"},{"from":"NOCTURNAL","to":"NORTH_WEST_PASSAGE","meters":434.7846944837164,"accessFactor":1,"accessPenaltyMeters":434.7846944837164,"accessBasis":"GPS_BASELINE"},{"from":"NOCTURNAL","to":"PRIMATE_CANYON","meters":49.61766500484374,"accessFactor":0.9,"accessPenaltyMeters":44.655898504359364,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"NOCTURNAL","to":"PRIMATE_PAVILLION","meters":153.04395928444524,"accessFactor":1,"accessPenaltyMeters":153.04395928444524,"accessBasis":"GPS_BASELINE"},{"from":"NOCTURNAL","to":"TETON","meters":521.9138050332882,"accessFactor":1,"accessPenaltyMeters":521.9138050332882,"accessBasis":"GPS_BASELINE"},{"from":"NOCTURNAL","to":"TROPICAL_BIRDS","meters":140.44139365573847,"accessFactor":1,"accessPenaltyMeters":140.44139365573847,"accessBasis":"GPS_BASELINE"},{"from":"NOCTURNAL","to":"WEST_ADMIN","meters":100.8817304689436,"accessFactor":1,"accessPenaltyMeters":100.8817304689436,"accessBasis":"GPS_BASELINE"},{"from":"NOCTURNAL","to":"ZAMBEZI","meters":162.97004643204536,"accessFactor":1,"accessPenaltyMeters":162.97004643204536,"accessBasis":"GPS_BASELINE"},{"from":"NORTH_WEST_PASSAGE","to":"PRIMATE_CANYON","meters":394.74537474831794,"accessFactor":1,"accessPenaltyMeters":394.74537474831794,"accessBasis":"GPS_BASELINE"},{"from":"NORTH_WEST_PASSAGE","to":"PRIMATE_PAVILLION","meters":283.13987835370824,"accessFactor":1,"accessPenaltyMeters":283.13987835370824,"accessBasis":"GPS_BASELINE"},{"from":"NORTH_WEST_PASSAGE","to":"TETON","meters":137.54391742730496,"accessFactor":0.8,"accessPenaltyMeters":110.03513394184398,"accessBasis":"EXPLICIT_SAVED_CONNECTION"},{"from":"NORTH_WEST_PASSAGE","to":"TROPICAL_BIRDS","meters":572.4916551794838,"accessFactor":1,"accessPenaltyMeters":572.4916551794838,"accessBasis":"GPS_BASELINE"},{"from":"NORTH_WEST_PASSAGE","to":"WEST_ADMIN","meters":465.8422688581184,"accessFactor":1,"accessPenaltyMeters":465.8422688581184,"accessBasis":"GPS_BASELINE"},{"from":"NORTH_WEST_PASSAGE","to":"ZAMBEZI","meters":308.1464669653667,"accessFactor":1,"accessPenaltyMeters":308.1464669653667,"accessBasis":"GPS_BASELINE"},{"from":"PRIMATE_CANYON","to":"PRIMATE_PAVILLION","meters":119.71053482208401,"accessFactor":0.8,"accessPenaltyMeters":95.76842785766722,"accessBasis":"EXPLICIT_SAVED_CONNECTION"},{"from":"PRIMATE_CANYON","to":"TETON","meters":489.45561971089785,"accessFactor":1,"accessPenaltyMeters":489.45561971089785,"accessBasis":"GPS_BASELINE"},{"from":"PRIMATE_CANYON","to":"TROPICAL_BIRDS","meters":187.56016945260276,"accessFactor":1,"accessPenaltyMeters":187.56016945260276,"accessBasis":"GPS_BASELINE"},{"from":"PRIMATE_CANYON","to":"WEST_ADMIN","meters":140.82380738199785,"accessFactor":1,"accessPenaltyMeters":140.82380738199785,"accessBasis":"GPS_BASELINE"},{"from":"PRIMATE_CANYON","to":"ZAMBEZI","meters":149.6968413548715,"accessFactor":0.9,"accessPenaltyMeters":134.72715721938437,"accessBasis":"SHARED_SAVED_NEIGHBORHOOD"},{"from":"PRIMATE_PAVILLION","to":"TETON","meters":370.293600675028,"accessFactor":1,"accessPenaltyMeters":370.293600675028,"accessBasis":"GPS_BASELINE"},{"from":"PRIMATE_PAVILLION","to":"TROPICAL_BIRDS","meters":289.35534738323804,"accessFactor":1,"accessPenaltyMeters":289.35534738323804,"accessBasis":"GPS_BASELINE"},{"from":"PRIMATE_PAVILLION","to":"WEST_ADMIN","meters":191.14256064372205,"accessFactor":1,"accessPenaltyMeters":191.14256064372205,"accessBasis":"GPS_BASELINE"},{"from":"PRIMATE_PAVILLION","to":"ZAMBEZI","meters":70.1402784666306,"accessFactor":0.8,"accessPenaltyMeters":56.11222277330449,"accessBasis":"EXPLICIT_SAVED_CONNECTION"},{"from":"TETON","to":"TROPICAL_BIRDS","meters":651.192185626034,"accessFactor":1,"accessPenaltyMeters":651.192185626034,"accessBasis":"GPS_BASELINE"},{"from":"TETON","to":"WEST_ADMIN","meters":529.6270044396,"accessFactor":1,"accessPenaltyMeters":529.6270044396,"accessBasis":"GPS_BASELINE"},{"from":"TETON","to":"ZAMBEZI","meters":371.3934522745182,"accessFactor":1,"accessPenaltyMeters":371.3934522745182,"accessBasis":"GPS_BASELINE"},{"from":"TROPICAL_BIRDS","to":"WEST_ADMIN","meters":134.3538929845857,"accessFactor":1,"accessPenaltyMeters":134.3538929845857,"accessBasis":"GPS_BASELINE"},{"from":"TROPICAL_BIRDS","to":"ZAMBEZI","meters":280.78673609909043,"accessFactor":1,"accessPenaltyMeters":280.78673609909043,"accessBasis":"GPS_BASELINE"},{"from":"WEST_ADMIN","to":"ZAMBEZI","meters":159.75465170947604,"accessFactor":1,"accessPenaltyMeters":159.75465170947604,"accessBasis":"GPS_BASELINE"}],"fixedDenominatorMeters":807.6262463035904,"directConnectionFactor":0.8,"sharedNeighborhoodFactor":0.9,"otherFactor":1,"overlapsStacked":false,"transitiveNeighborhoodMerging":false,"acceptedLongRoute":["ZAMBEZI","TROPICAL_BIRDS"],"acceptedLongRouteDiscounted":false,"formulaApproved":true,"approvalQuestionId":"call_97aaa12c08a84a0e8afed222696e481c","walkingTimeClaimed":false,"walkingDistancesMeasured":false,"productionWritten":false,"accessProposalDigest":"d4100dc85c5b031a537875b0cd84abada922c8bfb16ac510130ac6467750275b"}}$data$::jsonb $policy$;
revoke all on function public.static_weekly_manual_absence_policy() from public,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;
create or replace function public.static_weekly_manual_assert_absence_score(p_day jsonb,p_normal jsonb,p_policy jsonb,p_availability jsonb,p_rows jsonb,p_config jsonb)
returns void language plpgsql set search_path=pg_catalog,public as $fn$
declare input jsonb:=p_day->'input';plan jsonb:=p_day->'plan';d text:=p_day->>'serviceDate';
 start_at text:=plan#>>'{checkedWindow,start}';end_at text:=plan#>>'{checkedWindow,end}';
 phase jsonb;prior jsonb;loan jsonb;helper jsonb;recipient jsonb;group_row jsonb;slice jsonb;owners jsonb;points jsonb;
 expected jsonb;actual jsonb;anchors jsonb;keys jsonb;code text;owner text;normal_owner text;t text;last_t text;
 p_sum numeric:=0;l_sum numeric:=0;total_minutes numeric:=0;p_loss numeric;l_loss numeric;distance numeric;minutes numeric;n integer;
 tammy text:=p_config#>>'{slots,TAMMY,slotId}';china_minutes integer:=0;tammy_reliefs integer:=0;preferred_minutes integer:=0;
 preferred_key text;preferred_slot text;preferred_codes text[];
begin
 select jsonb_agg(r->'code' order by r->>'code') into keys from jsonb_array_elements(p_policy->'groups') r;
 select coalesce(jsonb_agg(jsonb_build_object('start',case when ord=1 then start_at else ph->>'start' end,
  'end',least(ph->>'end',end_at)) order by ord),'[]') into expected
  from jsonb_array_elements(p_normal->'phases') with ordinality x(ph,ord)
  where (case when ord=1 then start_at else ph->>'start' end)<least(ph->>'end',end_at);
 select coalesce(jsonb_agg(ph->'window' order by ord),'[]') into actual from jsonb_array_elements(plan->'phaseOwners') with ordinality x(ph,ord);
 if actual is distinct from expected then raise exception 'Manual native phase window or static departure changed';end if;
 prior:=null;
 for phase in select value from jsonb_array_elements(plan->'phaseOwners') loop
  if (select coalesce(jsonb_agg(k order by k),'[]') from jsonb_object_keys(phase->'owners') k) is distinct from keys then raise exception 'Manual native phase does not own the 23 exact groups';end if;
  for code,owner in select key,value#>>'{}' from jsonb_each(phase->'owners') loop
   if not exists(select 1 from jsonb_array_elements(p_availability) r where r->>'serviceDate'=d and r->>'slotId'=owner
    and r->>'status'='working' and r#>>'{shift,start}'<=phase#>>'{window,start}' and r#>>'{shift,end}'>=phase#>>'{window,end}')
   then raise exception 'Manual native phase owner is not actually on shift';end if;
   if prior is not null and prior#>>array['owners',code] is distinct from owner and not exists(
    select 1 from jsonb_array_elements(p_availability) r where r->>'serviceDate'=d and r->>'slotId'=prior#>>array['owners',code]
     and r#>>'{shift,end}'=phase#>>'{window,start}') then raise exception 'Manual native phase reshuffled an available owner';end if;
  end loop;
  foreach preferred_key in array array['KAREN','KATHY'] loop
   preferred_slot:=p_config#>>array['slots',preferred_key,'slotId'];
   preferred_codes:=case when preferred_key='KAREN' then array['ZAMBEZI','PRIMATE_PAVILLION'] else array['EAST_ADMIN','WEST_ADMIN'] end;
   if exists(select 1 from jsonb_array_elements(p_availability) r where r->>'serviceDate'=d and r->>'slotId'=preferred_slot
    and r->>'status'='working' and r#>>'{shift,start}'<=phase#>>'{window,start}' and r#>>'{shift,end}'>=phase#>>'{window,end}') then
    foreach code in array preferred_codes loop
     if phase#>>array['owners',code] is distinct from preferred_slot then preferred_minutes:=preferred_minutes+
      extract(epoch from ((phase#>>'{window,end}')::time-(phase#>>'{window,start}')::time))::integer/60;end if;
    end loop;
   end if;
  end loop;
  prior:=phase;
 end loop;
 select coalesce(jsonb_agg(r->'slotId' order by r->>'slotId'),'[]') into expected from jsonb_array_elements(p_availability) r where r->>'serviceDate'=d and r->>'status'='working';
 select coalesce(jsonb_agg(r->'recipientSlotId' order by r->>'recipientSlotId'),'[]') into actual from jsonb_array_elements(plan->'lunchPlans') r;
 if actual is distinct from expected then raise exception 'Manual native full-hour lunch plan omits or duplicates a worker';end if;
 for loan in select value from jsonb_array_elements(plan->'lunchPlans') loop
  select r into strict recipient from jsonb_array_elements(p_availability) r where r->>'serviceDate'=d and r->'slotId'=loan->'recipientSlotId';
  select r into strict helper from jsonb_array_elements(p_availability) r where r->>'serviceDate'=d and r->'slotId'=loan->'covererSlotId';
  if loan->'window' is distinct from recipient->'lunch' or (loan#>>'{window,end}')::time-(loan#>>'{window,start}')::time<>interval '1 hour'
   or loan->'recipientSlotId'=loan->'covererSlotId' or helper->>'status' is distinct from 'working'
   or helper#>>'{shift,start}'>loan#>>'{window,start}' or helper#>>'{shift,end}'<loan#>>'{window,end}'
   or helper#>>'{lunch,start}'<loan#>>'{window,end}' and loan#>>'{window,start}'<helper#>>'{lunch,end}'
  then raise exception 'Manual native full-hour helper availability changed';end if;
  select coalesce(jsonb_agg(to_jsonb(codes.code) order by codes.code collate "C"),'[]') into expected from (
   select distinct key code from jsonb_array_elements(plan->'phaseOwners') p cross join lateral jsonb_each(p->'owners') o
   where p#>>'{window,start}'<loan#>>'{window,end}' and loan#>>'{window,start}'<p#>>'{window,end}' and o.value=loan->'recipientSlotId') codes;
  if loan->'areas' is distinct from expected then raise exception 'Manual native lunch omits inherited groups';end if;
  if loan->>'covererSlotId'=tammy then tammy_reliefs:=tammy_reliefs+1;end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(plan->'lunchPlans') a join jsonb_array_elements(plan->'lunchPlans') b
  on a->'recipientSlotId'<b->'recipientSlotId' and a->'covererSlotId'=b->'covererSlotId'
   and a#>>'{window,start}'<b#>>'{window,end}' and b#>>'{window,start}'<a#>>'{window,end}')
 then raise exception 'Manual native helper appointments overlap';end if;
 -- Derive the slice boundaries independently from actual shift/lunch facts.
 select jsonb_agg(v order by v) into expected from (
  select distinct v from (
   select start_at v union all select end_at union all
   select ph#>>'{window,start}' from jsonb_array_elements(plan->'phaseOwners') ph union all
   select ph#>>'{window,end}' from jsonb_array_elements(plan->'phaseOwners') ph union all
   select av#>>'{lunch,start}' from jsonb_array_elements(p_availability) av where av->>'serviceDate'=d and av->>'status'='working' union all
   select av#>>'{lunch,end}' from jsonb_array_elements(p_availability) av where av->>'serviceDate'=d and av->>'status'='working'
  ) q where v>=start_at and v<=end_at) boundaries;
 select jsonb_agg(v order by v) into actual from (select distinct v from (
  select r#>>'{window,start}' v from jsonb_array_elements(plan->'coverage') r union all
  select r#>>'{window,end}' from jsonb_array_elements(plan->'coverage') r) q) boundaries;
 if actual is distinct from expected then raise exception 'Manual native actual duration slices changed';end if;
 last_t:=start_at;
 for slice in select value from jsonb_array_elements(plan->'coverage') loop
  t:=slice#>>'{window,start}';
  if t is distinct from last_t or t>=slice#>>'{window,end}' then raise exception 'Manual native scored coverage has a gap or overlap';end if;
  select ph into strict phase from jsonb_array_elements(plan->'phaseOwners') ph where ph#>>'{window,start}'<=t and t<ph#>>'{window,end}';
  points:='{}';owners:='{}';n:=0;p_loss:=0;
  for recipient in select r from jsonb_array_elements(p_availability) r where r->>'serviceDate'=d and r->>'status'='working'
   and r#>>'{shift,start}'<=t and t<r#>>'{shift,end}' and not(r#>>'{lunch,start}'<=t and t<r#>>'{lunch,end}') loop
   points:=points||jsonb_build_object(recipient->>'slotId',0);n:=n+1;
  end loop;
  if n=0 then raise exception 'Manual native coverage has no actually available owner';end if;
  for group_row in select value from jsonb_array_elements(p_policy->'groups') loop
   code:=group_row->>'code';normal_owner:=phase#>>array['owners',code];owner:=normal_owner;
   select r into strict recipient from jsonb_array_elements(p_availability) r where r->>'serviceDate'=d and r->>'slotId'=normal_owner;
   if recipient#>>'{lunch,start}'<=t and t<recipient#>>'{lunch,end}' then
    select l into strict loan from jsonb_array_elements(plan->'lunchPlans') l where l->>'recipientSlotId'=normal_owner;
    owner:=loan->>'covererSlotId';
   end if;
   if not(points ? owner) then raise exception 'Manual native owner is off shift or on lunch';end if;
   owners:=owners||jsonb_build_object(code,owner);points:=jsonb_set(points,array[owner],to_jsonb((points->>owner)::integer+(group_row->>'points')::integer));
   if owner=tammy and code not in('TETON','NORTH_WEST_PASSAGE','EAST_END_RESTROOMS','CHINA') then raise exception 'Manual native Tammy received an unauthorized extra';end if;
   if code in('TETON','NORTH_WEST_PASSAGE','EAST_END_RESTROOMS') and points ? tammy and owner is distinct from tammy then raise exception 'Manual native Tammy lost an available core area';end if;
   select r->'baseCodes' into strict anchors from jsonb_array_elements(input->'roster') r where r->>'slotId'=owner;
   select min(case when anchor=code then 0 else (
    select (pair->>'accessPenaltyMeters')::numeric from jsonb_array_elements(p_policy#>'{access,pairs}') pair
     where pair->>'from'=anchor and pair->>'to'=code or pair->>'from'=code and pair->>'to'=anchor) end)
    into distance from jsonb_array_elements_text(anchors) anchor;
   if distance is null then raise exception 'Manual native approved normal distance anchor missing';end if;
   p_loss:=p_loss+distance/807.6262463035904/23;
  end loop;
  select case when n=1 then 0 else sum(abs((v#>>'{}')::numeric-136.0/n))/(272*(1-1.0/n)) end into l_loss from jsonb_each(points) x(k,v);
  minutes:=extract(epoch from ((slice#>>'{window,end}')::time-t::time))/60;
  if slice->'owners' is distinct from owners or slice->'zooWideCoverage' is distinct from to_jsonb(
   (select count(*)=1 from jsonb_array_elements(p_availability) r where r->>'serviceDate'=d and r->>'status'='working' and r#>>'{shift,start}'<=t and t<r#>>'{shift,end}') and n=1)
   or p_loss not between 0 and 1.000000001 or l_loss not between 0 and 1.000000001
  then raise exception 'Manual native complete 23-group slice, Zoo Wide Coverage or penalty scale differs';end if;
  if owners->>'CHINA'=tammy then china_minutes:=china_minutes+minutes::integer;end if;
  p_sum:=p_sum+minutes*p_loss;l_sum:=l_sum+minutes*l_loss;total_minutes:=total_minutes+minutes;last_t:=slice#>>'{window,end}';
 end loop;
 if last_t is distinct from end_at or total_minutes<=0
  or abs((plan#>>'{scoreBreakdown,proximityPenalty}')::numeric-100*p_sum/total_minutes)>0.000001
  or abs((plan#>>'{scoreBreakdown,workloadPenalty}')::numeric-100*l_sum/total_minutes)>0.000001
  or abs((plan#>>'{scoreBreakdown,combinedPenalty}')::numeric-100*(.75*p_sum+.25*l_sum)/total_minutes)>0.000001
  or abs((plan->>'normalizedScore')::numeric-(.75*p_sum+.25*l_sum)/total_minutes)>0.00000001
  or plan->'policyLimits' is distinct from jsonb_build_object('tammyChinaExtraMinutes',china_minutes,'tammyReliefAppointments',tammy_reliefs,'preferredCoreMovedMinutes',preferred_minutes)
 then raise exception 'Manual native exact fixed 75/25 duration score or personal priority evidence differs';end if;
end $fn$;
revoke all on function public.static_weekly_manual_assert_absence_score(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)
 from public,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;
-- Successor component, exercised only in the current owned disposable fixture.
set local lock_timeout='5s';
set local statement_timeout='120s';

create or replace function public.static_weekly_manual_assert_native_projection(p_operation uuid,p_manager uuid,p_envelope jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public as $fn$
declare ctx jsonb;basis jsonb;snapshot jsonb:=p_envelope->'semantic_snapshot';a jsonb:=p_envelope->'authority';source jsonb;
 frame date;publication uuid;version uuid;expected_dates jsonb;day date;dow integer;normal_day jsonb;day_basis jsonb;plan jsonb;
 item jsonb;w jsonb;parent jsonb;link jsonb;availability jsonb;expected jsonb;actual jsonb;slot jsonb;person jsonb;
 base jsonb;exceptions jsonb;summary jsonb;links jsonb:='{}';expected_availability jsonb:='[]';absent jsonb;
 complete_start text;complete_end text;normal_start text;normal_end text;previous_owner text;previous_end text;
 row_owner text;owner_config jsonb;code text;normal_changed boolean;day_changed boolean;inherited boolean;
 input jsonb;phase jsonb;previous_phase jsonb;slice jsonb;loan jsonb;owners jsonb;points jsonb;anchors jsonb;policy jsonb;
 p_loss numeric;l_loss numeric;n integer;minutes numeric;total_minutes numeric;weighted_p numeric;weighted_l numeric;actual_effort numeric;
 count_rows integer;budget integer;assignment uuid;key text;window_start text;window_end text;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 ctx:=public.static_weekly_pending_context(p_operation,p_manager);
 perform public.static_weekly_assert_exact_object(p_envelope,
  array['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','semantic_snapshot','database_projection_identity'],
  array['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','semantic_snapshot','database_projection_identity'],'manual native projection');
 perform public.static_weekly_assert_exact_object(snapshot,
  array['schema','originalCommand','originalSource','scopeDates','weekStart','generation','catalogEntryDigest','nativeBasisDigest'],
  array['schema','originalCommand','originalSource','scopeDates','weekStart','generation','catalogEntryDigest','nativeBasisDigest'],'manual native original snapshot');
 if snapshot->>'schema' is distinct from 'custodial.approved-manual-pending-staffing-snapshot.v1'
  or snapshot->'originalCommand' is distinct from ctx->'originalCommand'
  or coalesce(snapshot->>'weekStart','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or coalesce(snapshot->>'nativeBasisDigest','')!~'^[0-9a-f]{64}$'
 then raise exception 'Manual native original command differs';end if;
 frame:=(snapshot->>'weekStart')::date;publication:=(snapshot#>>'{originalSource,publication_id}')::uuid;
 basis:=public.static_weekly_manual_period_basis(p_manager,publication,frame,
  (select current_revision from public.static_weekly_schedule_control where singleton),p_operation);
 source:=basis->'normalSource';version:=(basis->>'versionId')::uuid;exceptions:=basis->'preparedExceptions';summary:=basis->'preparedSummary';
 if frame::text is distinct from basis->>'frameStart' or snapshot->'originalSource' is distinct from basis->'originalSource'
  or snapshot->'generation' is distinct from basis->'generation' or snapshot->'catalogEntryDigest' is distinct from basis->'catalogEntryDigest'
  or (not (ctx->>'afterFact')::boolean and snapshot->'nativeBasisDigest' is distinct from basis->'basisDigest')
 then raise exception 'Manual native current Source or preparation basis changed';end if;
 if (ctx->>'afterFact')::boolean and not exists(select 1 from public.static_weekly_staffing_staged_candidates s
  where s.operation_id=p_operation and s.candidate_kind='projection' and s.service_date=frame and s.payload_json->'envelope'=p_envelope)
 then raise exception 'Manual native acceptance must use the exact immutable staged preview';end if;
 select jsonb_agg(d::date::text order by d) into expected_dates from generate_series(
  greatest(frame,(ctx#>>'{originalCommand,semanticBody,startDate}')::date),
  least(frame+6,(ctx#>>'{originalCommand,semanticBody,endDate}')::date),'1 day') d;
 if snapshot->'scopeDates' is distinct from expected_dates or a->'compilerInput' is distinct from source
  or a->>'schema' is distinct from 'custodial.approved-manual-period-projection-authority.v1'
  or a->>'sourceDigest' is distinct from basis->>'normalSourceDigest'
  or a->>'sourcePublicationId' is distinct from publication::text or a->>'sourceVersionId' is distinct from version::text
  or a->>'frameStart' is distinct from frame::text or a->>'frameEnd' is distinct from (frame+6)::text
  or a->'normalSourceChanged' is distinct from 'false'::jsonb or a->'objectiveSolverRerun' is distinct from 'false'::jsonb
  or a->>'acceptedExceptionsDigest' is distinct from public.static_weekly_digest_jsonb(exceptions)
  or a->>'formulaObjectiveDigest' is distinct from '7796e95573b389d8d77fc80502d4f6f7f1b54a5155327f9a7f1eb42a7137f531'
  or p_envelope->'applied_exceptions' is distinct from summary
  or p_envelope->'adapter' is distinct from '{"schema":"custodial.approved-manual-period-database-adapter.v1","version":"approved-manual-period-v1"}'::jsonb
  or p_envelope->>'compiler_version' is distinct from 'approved-manual-period-v1'
  or p_envelope->>'service_date' is distinct from frame::text or p_envelope->>'week_start' is distinct from frame::text
  or p_envelope->>'week_end' is distinct from (frame+6)::text
  or p_envelope->>'authority_digest' is distinct from public.static_weekly_digest_jsonb(a)
  or p_envelope->>'database_projection_identity' is distinct from public.static_weekly_digest_jsonb(p_envelope-'database_projection_identity')
  or p_envelope->'objective' is distinct from jsonb_build_object('contract','OWNER_APPROVED_MANUAL_DATED_75_25_V2',
   'formulaObjectiveDigest',a->'formulaObjectiveDigest','proximityPercent',75,'workloadPercent',25,'normalDaysOptimized',false)
  or p_envelope->'metrics' is distinct from jsonb_build_object('hardConstraints',a->'hardConstraintCount','violations',0)
  or p_envelope#>>'{receipt,schema}' is distinct from 'custodial.approved-manual-native-feasibility-data.v1'
  or p_envelope#>'{receipt,hardConstraintCount}' is distinct from a->'hardConstraintCount'
  or p_envelope#>'{receipt,hardConstraintDigest}' is distinct from a->'hardConstraintDigest'
  or p_envelope#>'{receipt,fixedWitnessDigest}' is distinct from a->'fixedWitnessDigest'
 then raise exception 'Manual native envelope identity or approved formula differs';end if;
 if jsonb_typeof(p_envelope->'assignments') is distinct from 'array' or jsonb_array_length(p_envelope->'assignments') not between 1 and 4096
  or jsonb_typeof(a->'datedDayBases') is distinct from 'array' or jsonb_array_length(a->'datedDayBases')>7
  or jsonb_typeof(a->'parentLinks') is distinct from 'array' or jsonb_array_length(a->'parentLinks')>4096
  or jsonb_typeof(a->'projectionAvailability') is distinct from 'array' or jsonb_array_length(a->'projectionAvailability')>224
  or (select count(*)<>count(distinct r->>'plan_work_id') from jsonb_array_elements(p_envelope->'assignments') r)
  or (select count(*)<>count(distinct r->>'serviceDate') from jsonb_array_elements(a->'datedDayBases') r)
  or (select count(*)<>count(distinct r->>'workId') from jsonb_array_elements(a->'parentLinks') r)
 then raise exception 'Manual native bounded unique records required';end if;
 -- This first admission supports full-day canonical PTO/absence and its exact
 -- cancellation. Other exception shapes fail closed, never silently disappear.
 if exists(select 1 from jsonb_array_elements(exceptions) e where e->>'type' not in('pto','daily_absence') or e ? 'window')
 then raise exception using errcode='0A000',message='Manual native exception requires its qualified dated profile';end if;
 policy:=public.static_weekly_manual_absence_policy();
 for base in select value from jsonb_array_elements(source#>'{version,slotAvailability}') loop
  dow:=(base->>'dayOfWeek')::integer;day:=frame+mod(dow-extract(dow from frame)::integer+7,7);
  availability:=public.static_weekly_approved_dated_effective_availability(base,base->>'slotId',day,exceptions);
  if availability->>'status'='working' and exists(select 1 from jsonb_array_elements(exceptions) e
   join jsonb_array_elements(source#>'{version,slotAvailability}') av on av->'slotId'=e#>'{payload,slotId}' and av->>'dayOfWeek'=dow::text and av->>'status'='working'
   where e->>'serviceDate'=day::text and e->>'type' in('pto','daily_absence')) then
   availability:=availability||'{"blockedWindows":[]}'::jsonb;
  end if;
  select s into strict slot from jsonb_array_elements(source->'slots') s where s->'id'=base->'slotId';
  select i into strict person from jsonb_array_elements(slot->'incumbencies') i
   where (i->>'effectiveStart')::date<=day and (i->>'effectiveEnd' is null or day<(i->>'effectiveEnd')::date);
  expected_availability:=expected_availability||jsonb_build_array(availability||jsonb_build_object(
   'serviceDate',day::text,'incumbentPersonId',person->'personId','incumbentName',person->'displayName'));
 end loop;
 select coalesce(jsonb_agg(r order by (r->>'dayOfWeek')::integer,r->>'slotId' collate "C"),'[]') into expected from jsonb_array_elements(expected_availability) r;
 select coalesce(jsonb_agg(r order by (r->>'dayOfWeek')::integer,r->>'slotId' collate "C"),'[]') into actual from jsonb_array_elements(a->'projectionAvailability') r;
 if actual is distinct from expected then raise exception 'Manual native static hours, eligibility or actual absence changed';end if;

 for day in select generate_series(frame,frame+6,'1 day')::date loop
  dow:=extract(dow from day)::integer;
  select r into strict normal_day from jsonb_array_elements(policy->'days') r where r->>'weekday'=dow::text;
  select coalesce(jsonb_agg(r->'incumbentPersonId' order by r->>'incumbentPersonId'),'[]') into absent
   from jsonb_array_elements(expected_availability) r where r->>'serviceDate'=day::text and r->>'status'='absent';
  day_changed:=jsonb_array_length(absent)>0;
  select r into day_basis from jsonb_array_elements(a->'datedDayBases') r where r->>'serviceDate'=day::text;
  if day_changed is distinct from (day_basis is not null) then raise exception 'Manual native complete dated day set differs';end if;
  normal_start:=normal_day#>>'{checkedWindow,start}';normal_end:=normal_day#>>'{checkedWindow,end}';
  select max(r#>>'{shift,start}'),max(r#>>'{shift,end}') into complete_start,complete_end
   from jsonb_array_elements(expected_availability) r where r->>'serviceDate'=day::text and r->>'status'='working';
  if complete_start is null or complete_start>=complete_end then raise exception 'Manual native staffed window is empty';end if;
  if day_changed then
   if jsonb_array_length(absent) not between 1 and 2 or day_basis->>'kind' is distinct from 'ABSENCE' then
    raise exception using errcode='0A000',message='Third absence requires the retained two-absence basis and actual CoverAll hours';end if;
   input:=day_basis->'input';plan:=day_basis->'plan';
   if input->>'inputDigest' is distinct from public.static_weekly_digest_jsonb(input-'inputDigest')
    or plan->>'planDigest' is distinct from public.static_weekly_digest_jsonb(plan-'planDigest')
    or input->'sourceDigest' is distinct from a->'sourceDigest' or input->'formulaObjectiveDigest' is distinct from a->'formulaObjectiveDigest'
    or input->>'serviceDate' is distinct from day::text or plan->>'serviceDate' is distinct from day::text
    or input->'absentPersonIds' is distinct from absent or plan->'absentPersonIds' is distinct from absent
    or input->'checkedWindow' is distinct from jsonb_build_object('start',complete_start,'end',complete_end)
    or plan->'checkedWindow' is distinct from input->'checkedWindow' or plan->'inputDigest' is distinct from input->'inputDigest'
    or plan->'proposalDigest' is distinct from a->'formulaObjectiveDigest' or input->'access' is distinct from policy->'access'
    or input->'groups' is distinct from policy->'groups' or plan->'groups' is distinct from policy->'groups'
    or plan->'hardFeasibilityValidatedBeforeScoring' is distinct from 'true'::jsonb or plan->'globalOptimalityClaim' is distinct from 'false'::jsonb
    or exists(select 1 from unnest(array['publicationEligible','weeklyBaselineChanged','productionWritten','contractorBooked']) k where plan->k is distinct from 'false'::jsonb)
   then raise exception 'Manual native dated immutable input, source or formula changed';end if;
   select coalesce(jsonb_agg(jsonb_build_array(r->'slotId',r->'incumbentPersonId',r->'shift',r->'lunch') order by r->>'slotId'),'[]') into expected
    from jsonb_array_elements(expected_availability) r where r->>'serviceDate'=day::text and r->>'status'='working';
   select coalesce(jsonb_agg(jsonb_build_array(r->'slotId',r->'personId',r->'shift',r->'lunch') order by r->>'slotId'),'[]') into actual from jsonb_array_elements(input->'roster') r;
   if expected is distinct from actual then raise exception 'Manual native dated roster changed';end if;
   for item in select value from jsonb_array_elements(input->'roster') loop
    select r->'baseGroups' into strict expected from jsonb_array_elements(normal_day->'employees') r where r->>'name'=item->>'name';
    select coalesce(jsonb_agg(to_jsonb(r->>'code') order by ord),'[]') into actual
     from jsonb_array_elements(expected) with ordinality x(name,ord) join jsonb_array_elements(policy->'groups') r on r->'name'=name;
    if item->'baseCodes' is distinct from actual then raise exception 'Manual native distance anchor changed from approved normal day';end if;
   end loop;
  end if;

  for item in select value from jsonb_array_elements(p_envelope->'assignments') where value->>'service_date'=day::text loop
   w:=item->'work_snapshot';parent:=null;link:=null;
   select r into parent from jsonb_array_elements(source#>'{version,assignments}') r
    where r->>'dayOfWeek'=dow::text and r->'workId'=item->'work_id';
   if parent is null then
    select r into strict link from jsonb_array_elements(a->'parentLinks') r where r->'workId'=item->'work_id';
    select r into strict parent from jsonb_array_elements(source#>'{version,assignments}') r where r->>'dayOfWeek'=dow::text and r->'workId'=link->'parentWorkId';
    if link->'serviceDate' is distinct from item->'service_date' or link->'window' is distinct from w->'window' or link->'slotId' is distinct from item->'owner_slot_id'
     or coalesce(item->>'work_id','')!~'^manual-dated:[0-9a-f]{64}$' then raise exception 'Manual native parent lineage differs';end if;
   end if;
   select r into strict availability from jsonb_array_elements(expected_availability) r where r->'slotId'=item->'owner_slot_id' and r->>'serviceDate'=day::text;
   select value into strict owner_config from jsonb_each(basis#>'{ownerConfig,slots}') where value->'slotId'=item->'owner_slot_id';
   window_start:=w#>>'{window,start}';window_end:=w#>>'{window,end}';
   perform public.static_weekly_v3_assert_window(w->'window','manual native custody');
   if item->>'status' is distinct from 'assigned' or item->'reason_code' is distinct from 'null'::jsonb
    or item->>'day_of_week' is distinct from dow::text or item->>'plan_work_id' is distinct from dow::text||':'||(item->>'work_id')
    or item->'owner_person_id' is distinct from availability->'incumbentPersonId' or item->'optimized_owner_person_id' is distinct from item->'owner_person_id'
    or item->'optimized_owner_slot_id' is distinct from item->'owner_slot_id' or item ? 'owner_kind' or item ? 'capacity_id'
    or availability->>'status' is distinct from 'working' or window_start<availability#>>'{shift,start}' or window_end>availability#>>'{shift,end}'
    or item->'baseline_owner_slot_id' is distinct from parent->'originSlotId' or w->'originSlotId' is distinct from parent->'originSlotId'
   then raise exception 'Manual native actual static owner, window or original actor changed';end if;
   select r into strict base from jsonb_array_elements(expected_availability) r where r->'slotId'=parent->'originSlotId' and r->>'serviceDate'=day::text;
   if item->'baseline_owner_person_id' is distinct from base->'incumbentPersonId' or item->'original_actor_person_id' is distinct from base->'incumbentPersonId'
    or item->'baseline_owner_name' is distinct from base->'incumbentName' or item->'original_actor_name' is distinct from base->'incumbentName'
    or item->>'owner_digest' is distinct from public.static_weekly_digest_jsonb(jsonb_build_object('planWorkId',item->'plan_work_id','slotId',item->'owner_slot_id','personId',item->'owner_person_id','serviceDate',item->'service_date'))
    or item->>'exact_owner_identity' is distinct from public.static_weekly_digest_jsonb(jsonb_build_object('plan_work_id',item->'plan_work_id','service_date',item->'service_date','optimized_owner_slot_id',item->'owner_slot_id','optimized_owner_person_id',item->'owner_person_id','baseline_owner_slot_id',parent->'originSlotId','baseline_owner_person_id',base->'incumbentPersonId'))
   then raise exception 'Manual native owner lineage digest changed';end if;
   inherited:=day_changed and exists(select 1 from jsonb_array_elements(plan->'phaseOwners') with ordinality x(ph,phase_number)
    where phase_number>1 and ph#>>'{window,start}'<=window_start and window_start<ph#>>'{window,end}');
   expected:=jsonb_build_object('workId',item->'work_id','dayOfWeek',dow,'originSlotId',parent->'originSlotId',
    'locationId',parent->'locationId','locationCodeSnapshot',parent->'locationCodeSnapshot','locationNameSnapshot',parent->'locationNameSnapshot',
    'serviceMode',parent->'serviceMode','includedLocations',parent->'includedLocations','window',w->'window',
    'serviceEffortMinutes',w->'serviceEffortMinutes','serviceEffortProvenance',w->'serviceEffortProvenance',
    'priority',parent->'priority','priorityProvenance',parent->'priorityProvenance','required',parent->'required',
    'coveragePolicy',null,'bestEffortCoverage',false,'coveragePolicyOrder',null,'coveragePolicyProvenance',null,
    'requiredQualifications',parent->'requiredQualifications','qualificationProvenance',parent->'qualificationProvenance',
    'restrictions',parent->'restrictions','restrictionProvenance',parent->'restrictionProvenance','restrictedSlotIds',parent->'restrictedSlotIds',
    'manualLock',false,'manualLockSlotId',null,'overlayWork',false);
   if jsonb_array_length(coalesce(parent->'normalAssignmentRestrictedSlotIds','[]'))>0 then
    expected:=expected||jsonb_build_object('normalAssignmentRestrictedSlotIds',parent->'normalAssignmentRestrictedSlotIds','coveragePurpose',parent->'coveragePurpose');
   end if;
   if inherited and dow<>1 and parent->>'locationCodeSnapshot'='HERPETARIUM'
    and parent->'restrictedSlotIds' ? (basis#>>'{ownerConfig,slots,ALIJAH,slotId}') then
    expected:=expected||jsonb_build_object('restrictedSlotIds',(parent->'restrictedSlotIds')-(basis#>>'{ownerConfig,slots,ALIJAH,slotId}'),
     'normalAssignmentRestrictedSlotIds',jsonb_build_array(basis#>>'{ownerConfig,slots,ALIJAH,slotId}'),
     'coveragePurpose','INHERITED_ALERTS_AND_ISSUES_ONLY','restrictionProvenance',(parent->>'restrictionProvenance')||';normal-assignment-scope:fe02bbdebc736d95360b55cc7dfe5b73c5a9eaa76f364f1c0f4420a0afb9950f');
   end if;
   if w is distinct from expected or not ((availability->'qualifications') @> (w->'requiredQualifications'))
    or w->'restrictedSlotIds' ? (item->>'owner_slot_id') or owner_config->'hardForbiddenFamilies' ? (w->>'locationCodeSnapshot')
    or exists(select 1 from jsonb_array_elements(w->'includedLocations') r where availability->'restrictions' ? (r->>'locationId'))
    or (item->>'owner_slot_id'=basis#>>'{ownerConfig,slots,TAMMY,slotId}' and w->>'locationCodeSnapshot' not in('TETON','NORTH_WEST_PASSAGE','EAST_END_RESTROOMS','CHINA'))
   then raise exception 'Manual native physical members, hard eligibility or scoped restriction changed: work %, fields %',item->>'work_id',
    (select coalesce(jsonb_agg(k order by k),'[]') from (select jsonb_object_keys(w||expected) k) q where w->k is distinct from expected->k);end if;
   if not day_changed and (link is not null or item->'owner_slot_id' is distinct from parent->'ownerSlotId' or w->'window' is distinct from parent->'window'
    or w->'serviceEffortMinutes' is distinct from parent->'serviceEffortMinutes' or w->'serviceEffortProvenance' is distinct from parent->'serviceEffortProvenance')
   then raise exception 'Manual native changed an approved normal day';end if;
   if day_changed and (window_end>parent#>>'{window,end}' or window_start<case
    when parent#>>'{window,start}'<=normal_start and parent#>>'{window,end}'>normal_start
     then least(parent#>>'{window,start}',complete_start) else parent#>>'{window,start}' end)
   then raise exception 'Manual native custody exceeds its exact parent boundary';end if;
   -- A single unchanged owner can continue across the complete-crew arrival.
   -- That harmless merged row must still preserve the whole early base prefix.
   if day_changed and window_start<complete_start and (item->'owner_slot_id' is distinct from parent->'ownerSlotId'
    or window_start<>parent#>>'{window,start}' or window_end<least(parent#>>'{window,end}',complete_start))
   then raise exception 'Manual native early own-base custody differs';end if;
   if day_changed and window_end>complete_start then
    if window_end>complete_end then raise exception 'Manual native actual full-site window differs';end if;
    for phase in select value from jsonb_array_elements(plan->'phaseOwners') where value#>>'{window,start}'<window_end and window_start<value#>>'{window,end}' loop
     if phase#>>array['owners',w->>'locationCodeSnapshot'] is distinct from item->>'owner_slot_id' then raise exception 'Manual native selected phase differs from stored custody';end if;
    end loop;
   end if;
   select assignment_id into strict assignment from public.weekly_schedule_slot_assignments
    where version_id=version and day_of_week=dow and work_id=parent->>'workId';
   links:=links||jsonb_build_object(item->>'plan_work_id',assignment::text);
  end loop;

  -- Every physical group tiles the complete actual staffed window once.
  for code in select r->>'code' from jsonb_array_elements(policy->'groups') r loop
   previous_end:=complete_start;previous_owner:=null;
   for item in select r from jsonb_array_elements(p_envelope->'assignments') r where r->>'service_date'=day::text
    and r#>>'{work_snapshot,locationCodeSnapshot}'=code and r#>>'{work_snapshot,window,end}'>complete_start
    order by r#>>'{work_snapshot,window,start}' loop
    window_start:=greatest(complete_start,item#>>'{work_snapshot,window,start}');window_end:=least(complete_end,item#>>'{work_snapshot,window,end}');
    if window_end<=window_start then continue;end if;
    if window_start<>previous_end then raise exception 'Manual native full-site gap or overlap';end if;
    if day_changed and previous_owner is not null and previous_owner<>item->>'owner_slot_id' and not exists(
     select 1 from jsonb_array_elements(expected_availability) r where r->>'serviceDate'=day::text and r->>'slotId'=previous_owner and r#>>'{shift,end}'=window_start)
    then raise exception 'Manual native owner moved before the static departure';end if;
    previous_end:=window_end;previous_owner:=item->>'owner_slot_id';
   end loop;
   if previous_end<>complete_end then raise exception 'Manual native full-site coverage incomplete';end if;
   select sum((r->>'serviceEffortMinutes')::integer) into budget from jsonb_array_elements(source#>'{version,assignments}') r where r->>'dayOfWeek'=dow::text and r->>'locationCodeSnapshot'=code;
   select sum((r#>>'{work_snapshot,serviceEffortMinutes}')::integer) into actual_effort from jsonb_array_elements(p_envelope->'assignments') r where r->>'service_date'=day::text and r#>>'{work_snapshot,locationCodeSnapshot}'=code;
   if actual_effort is distinct from budget then raise exception 'Manual native combined group workload budget changed';end if;
  end loop;
  if not day_changed and (select count(*) from jsonb_array_elements(p_envelope->'assignments') r where r->>'service_date'=day::text)
   <>(select count(*) from jsonb_array_elements(source#>'{version,assignments}') r where r->>'dayOfWeek'=dow::text)
  then raise exception 'Manual native omitted approved normal rows';end if;
  if day_changed then
   perform public.static_weekly_manual_assert_absence_score(day_basis,normal_day,policy,expected_availability,p_envelope->'assignments',basis->'ownerConfig');
  end if;
 end loop;
 if (select count(*) from jsonb_object_keys(links))<>jsonb_array_length(p_envelope->'assignments')
  or exists(select 1 from jsonb_array_elements(a->'parentLinks') l where not exists(select 1 from jsonb_array_elements(p_envelope->'assignments') r where r->'work_id'=l->'workId' and r->'service_date'=l->'serviceDate'))
 then raise exception 'Manual native foreign row or unused parent link';end if;
 if (ctx->>'afterFact')::boolean and summary is distinct from public.static_weekly_accepted_exception_set(publication,frame)
 then raise exception 'Manual native original fact did not become exact accepted authority';end if;
 return jsonb_build_object('assignment_links',links,'projection_assignments',p_envelope->'assignments','afterFact',ctx->'afterFact');
end $fn$;
revoke all on function public.static_weekly_manual_assert_native_projection(uuid,uuid,jsonb) from public,anon,authenticated,service_role,
 static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;
create or replace function public.static_weekly_manual_native_lunch_policy(p_envelope jsonb) returns jsonb language plpgsql immutable set search_path=pg_catalog,public as $fn$
declare body jsonb;loans jsonb;
begin
 select coalesce(jsonb_agg(l order by (l->>'dayOfWeek')::integer,l->>'normalOwnerSlotId'),'[]') into loans from(
  select l from jsonb_array_elements(p_envelope#>'{authority,compilerInput,version,lunchCoveragePolicy,loans}') l
   where not exists(select 1 from jsonb_array_elements(p_envelope#>'{authority,datedDayBases}') d where extract(dow from (d->>'serviceDate')::date)::integer=(l->>'dayOfWeek')::integer)
  union all
  select jsonb_build_object('dayOfWeek',extract(dow from (d->>'serviceDate')::date)::integer,'normalOwnerSlotId',l->'recipientSlotId','window',l->'window',
   'areas',(select jsonb_agg(jsonb_build_object('locationCode',c,'covererSlotId',l->'covererSlotId') order by c) from jsonb_array_elements_text(l->'areas') c))
   from jsonb_array_elements(p_envelope#>'{authority,datedDayBases}') d cross join lateral jsonb_array_elements(d#>'{plan,lunchPlans}') l
 ) q;
 body:=jsonb_build_object('schema','memphis-zoo.static-weekly-full-hour-lunch-policy.v1','sourceDigest',p_envelope#>'{authority,sourceDigest}','loans',loans);
 return body||jsonb_build_object('policyDigest',public.static_weekly_digest_jsonb(body));
end $fn$;
revoke all on function public.static_weekly_manual_native_lunch_policy(jsonb) from public,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;
CREATE OR REPLACE FUNCTION public.static_weekly_manual_assert_native_lunch(p_projection_id uuid,p_document jsonb,p_envelope jsonb,p_publication uuid,p_week date)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
 projection public.weekly_schedule_compiled_projections%rowtype;
 loan jsonb;responsibility jsonb;segment jsonb;intent jsonb;availability jsonb;helper jsonb;
 base_work jsonb;expected jsonb;actual jsonb;helper_id text;identity_key text;
 start_time time;end_time time;
 projection_availability jsonb;projection_assignments jsonb;projection_work jsonb;
 full_hour_policy jsonb;full_hour boolean;planned_loan jsonb;normal_segment_window jsonb;
begin
 perform public.static_weekly_assert_exact_object(p_document,
  array['schema','persistence_authority','verification_status','week_start','base_authority_digest','base_replay_digest','source_input_digest','candidate_digest','loans','responsibilities','notification_intents','semantic_snapshot','document_identity'],
  array['schema','persistence_authority','verification_status','week_start','base_authority_digest','base_replay_digest','source_input_digest','candidate_digest','loans','responsibilities','notification_intents','semantic_snapshot','document_identity'],'lunch document');
 projection.publication_id:=p_publication;projection.week_start:=p_week;projection.projection_envelope:=p_envelope;projection.authority_digest:=p_envelope->>'authority_digest';projection.replay_digest:=p_envelope->>'replay_digest';

 projection_availability:=projection.projection_envelope#>'{authority,projectionAvailability}';
 projection_assignments:=projection.projection_envelope->'assignments';
 select jsonb_agg(r->'work_snapshot'||'{"schedulingMode":"flexible_coverage_ownership"}'::jsonb) into projection_work from jsonb_array_elements(p_envelope->'assignments') r;
 full_hour_policy:=public.static_weekly_manual_native_lunch_policy(p_envelope);full_hour:=true;
 if full_hour then
  perform public.static_weekly_assert_exact_object(full_hour_policy,
   array['schema','sourceDigest','loans','policyDigest'],array['schema','sourceDigest','loans','policyDigest'],'full lunch policy');
  if full_hour_policy->>'schema' is distinct from 'memphis-zoo.static-weekly-full-hour-lunch-policy.v1'
   or jsonb_typeof(full_hour_policy->'sourceDigest') is distinct from 'string'
   or coalesce(full_hour_policy->>'sourceDigest','') !~ '^[0-9a-f]{64}$'
   or full_hour_policy->>'policyDigest' is distinct from public.static_weekly_digest_jsonb(full_hour_policy-'policyDigest')
   or jsonb_typeof(full_hour_policy->'loans') is distinct from 'array'
   or jsonb_array_length(full_hour_policy->'loans')>1792 then raise exception 'invalid full lunch source policy';end if;
  for planned_loan in select value from jsonb_array_elements(full_hour_policy->'loans') loop
   perform public.static_weekly_assert_exact_object(planned_loan,
    array['dayOfWeek','normalOwnerSlotId','window','areas'],array['dayOfWeek','normalOwnerSlotId','window','areas'],'full lunch source loan');
   perform public.static_weekly_v3_assert_window(planned_loan->'window','full lunch source window');
   if jsonb_typeof(planned_loan->'dayOfWeek') is distinct from 'number'
    or (planned_loan->>'dayOfWeek') !~ '^[0-6]$'
    or jsonb_typeof(planned_loan->'normalOwnerSlotId') is distinct from 'string'
    or length(planned_loan->>'normalOwnerSlotId') not between 1 and 512
    or jsonb_typeof(planned_loan->'areas') is distinct from 'array'
    or jsonb_array_length(planned_loan->'areas')>128 then raise exception 'invalid full lunch source owner or areas';end if;
  end loop;
  select coalesce(jsonb_agg(entry order by entry::text),'[]') into expected from
   (select jsonb_build_array(value->'dayOfWeek',value->'normalOwnerSlotId') entry
    from jsonb_array_elements(full_hour_policy->'loans')) q;
  select coalesce(jsonb_agg(entry order by entry::text),'[]') into actual from
   (select jsonb_build_array(value->'day_of_week',value->'normal_owner_slot_id') entry
    from jsonb_array_elements(p_document->'loans')) q;
  if expected is distinct from actual then raise exception 'full lunch source owner set changed';end if;
 end if;

 if p_document->>'schema' is distinct from 'memphis-zoo.static-weekly-lunch-authority-document.v1'
  or p_document->>'persistence_authority' is distinct from 'NOT_PERSISTED'
  or p_document->>'verification_status' is distinct from 'VERIFIED'
  or p_document->>'week_start' is distinct from projection.week_start::text
  or p_document->>'base_authority_digest' is distinct from projection.authority_digest
  or p_document->>'base_replay_digest' is distinct from projection.replay_digest
  or p_document->>'source_input_digest' is distinct from projection.projection_envelope#>>'{authority,overlayInputDigest}'
  or coalesce(p_document->>'candidate_digest','') !~ '^[0-9a-f]{64}$'
  or p_document->>'document_identity' is distinct from public.static_weekly_digest_jsonb(p_document-'document_identity') then
  raise exception 'lunch document is not bound to the exact verified projection';
 end if;
 foreach identity_key in array array['loans','responsibilities','notification_intents'] loop
  if jsonb_typeof(p_document->identity_key) is distinct from 'array'
   or jsonb_array_length(p_document->identity_key)>4096 then raise exception 'lunch document array invalid'; end if;
 end loop;
 expected:=jsonb_build_object('schema','memphis-zoo.static-weekly-lunch-semantic-snapshot.v1',
  'loans_digest',public.static_weekly_digest_jsonb(p_document->'loans'),
  'responsibilities_digest',public.static_weekly_digest_jsonb(p_document->'responsibilities'),
  'notification_intents_digest',public.static_weekly_digest_jsonb(p_document->'notification_intents'));
 if p_document->'semantic_snapshot' is distinct from expected then raise exception 'lunch semantic snapshot mismatch'; end if;
 if (select count(*)<>count(distinct value->>'loan_id') from jsonb_array_elements(p_document->'loans'))
 or (select count(*)<>count(distinct value->>'responsibility_id') from jsonb_array_elements(p_document->'responsibilities'))
 or (select count(*)<>count(distinct value->>'notification_key') from jsonb_array_elements(p_document->'notification_intents')) then
  raise exception 'duplicate or missing lunch record identity'; end if;
 select coalesce(jsonb_agg(jsonb_build_array(value->>'serviceDate',value->>'slotId') order by value->>'serviceDate',value->>'slotId'),'[]')
 into expected from jsonb_array_elements(projection_availability)
 where value->>'status'='working' and (nullif(value->>'incumbentPersonId','') is not null or value->>'ownerKind'='CONTRACTOR_CAPACITY')
  and (value->>'ownerKind'='CONTRACTOR_CAPACITY' and value->>'breakChoice'='NONE' and value->'lunch'='null'::jsonb) is not true;
 select coalesce(jsonb_agg(jsonb_build_array(value->>'service_date',value->>'normal_owner_slot_id') order by value->>'service_date',value->>'normal_owner_slot_id'),'[]')
 into actual from jsonb_array_elements(p_document->'loans');
 if actual is distinct from expected then raise exception 'lunch coverage omits or duplicates a working owner'; end if;
 for loan in select value from jsonb_array_elements(p_document->'loans') loop
  perform public.static_weekly_capacity_assert_lunch_party(p_projection_id,loan,'normal_owner');
  perform public.static_weekly_assert_exact_object(loan,
   case when loan ? 'normal_owner_capacity_id' then array['loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_capacity_id','coverage_start','coverage_end','status','helper_slot_ids']
    else array['loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','coverage_start','coverage_end','status','helper_slot_ids'] end,
   array['loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','normal_owner_capacity_id','coverage_start','coverage_end','status','reason','helper_slot_ids','fallback','total_distance_minutes'],'lunch loan');
  if not (loan ?& array['reason','fallback','total_distance_minutes']) then raise exception 'lunch explanatory fields are missing'; end if;
  if coalesce(loan->>'loan_id','') !~ '^[0-9a-f]{64}$' then raise exception 'invalid lunch loan identity'; end if;
  select value into availability from jsonb_array_elements(projection_availability)
   where value->>'slotId'=loan->>'normal_owner_slot_id' and value->>'serviceDate'=loan->>'service_date';
  if not found or availability->>'incumbentPersonId' is distinct from loan->>'normal_owner_person_id'
   or loan->'day_of_week' is distinct from availability->'dayOfWeek'
   or loan->>'coverage_start' is distinct from availability#>>'{lunch,start}'
   or loan->>'coverage_end' is distinct from availability#>>'{lunch,end}' then raise exception 'lunch owner or scheduled hour mismatch'; end if;
  perform public.static_weekly_v3_assert_window(jsonb_build_object('start',loan->'coverage_start','end',loan->'coverage_end'),'lunch');
  start_time:=(loan->>'coverage_start')::time;end_time:=(loan->>'coverage_end')::time;
  if end_time-start_time<>interval '1 hour' or loan->>'status' is distinct from 'PLANNED' or jsonb_array_length(loan->'helper_slot_ids')<>1 or loan->'fallback' is distinct from 'null'::jsonb then raise exception 'Manual native lunch requires one helper for the complete scheduled hour';end if;
  perform public.static_weekly_v3_assert_string_array(loan->'helper_slot_ids','lunch helpers');
  if ((loan->>'status'='NO_AREAS' and jsonb_array_length(loan->'helper_slot_ids')=0 and loan->'fallback'='null'::jsonb)
    or (loan->>'status'='PLANNED' and (
      (full_hour and jsonb_array_length(loan->'helper_slot_ids') between 1 and 2
        and (loan->'fallback'='null'::jsonb or (jsonb_array_length(loan->'helper_slot_ids')=1 and loan->>'fallback'='only_one_eligible_custodian')))
      or (not full_hour and ((jsonb_array_length(loan->'helper_slot_ids')=2 and loan->'fallback'='null'::jsonb)
        or (jsonb_array_length(loan->'helper_slot_ids')=1 and loan->>'fallback'='only_one_eligible_custodian')))))) is not true then
   raise exception 'lunch helper cardinality or fallback invalid'; end if;
  if full_hour then
   select value into strict planned_loan from jsonb_array_elements(full_hour_policy->'loans')
    where value->'dayOfWeek'=loan->'day_of_week' and value->'normalOwnerSlotId'=loan->'normal_owner_slot_id';
   if planned_loan->'window' is distinct from jsonb_build_object('start',loan->'coverage_start','end',loan->'coverage_end')
    then raise exception 'full lunch source window changed';end if;
   if loan->'helper_slot_ids' is distinct from (
     select coalesce(jsonb_agg(coverer order by coverer collate "C"),'[]'::jsonb)
     from (select distinct area->>'covererSlotId' coverer
       from jsonb_array_elements(planned_loan->'areas') area) named)
    then raise exception 'full lunch source coverer set changed';end if;
  end if;
  for helper_id in select jsonb_array_elements_text(loan->'helper_slot_ids') loop
   select value into helper from jsonb_array_elements(projection_availability)
    where value->>'slotId'=helper_id and value->>'serviceDate'=loan->>'service_date';
   if not found or helper->>'status' is distinct from 'working' or helper_id=loan->>'normal_owner_slot_id'
    or (nullif(helper->>'incumbentPersonId','') is null and helper->>'ownerKind' is distinct from 'CONTRACTOR_CAPACITY')
    or ((helper#>>'{lunch,start}' is null or helper#>>'{lunch,end}' is null)
      and (helper->>'ownerKind'='CONTRACTOR_CAPACITY' and helper->>'breakChoice'='NONE' and helper->'lunch'='null'::jsonb) is not true) or (helper#>>'{shift,start}')::time>start_time
    or (helper#>>'{shift,end}')::time<end_time
    or ((helper#>>'{lunch,start}')::time<end_time and start_time<(helper#>>'{lunch,end}')::time) then
    raise exception 'lunch helper is not available for the full scheduled hour'; end if;
   if not exists(select 1 from jsonb_array_elements(p_document->'responsibilities') r
     where r->>'loan_id'=loan->>'loan_id' and r->>'coverer_slot_id'=helper_id) then
    raise exception 'lunch helper has no assigned responsibility'; end if;
  end loop;
 end loop;
 for responsibility in select value from jsonb_array_elements(p_document->'responsibilities') loop
  perform public.static_weekly_capacity_assert_lunch_party(p_projection_id,responsibility,'normal_owner');
  perform public.static_weekly_capacity_assert_lunch_party(p_projection_id,responsibility,'coverer');
  perform public.static_weekly_assert_exact_object(responsibility,
   array['responsibility_id','loan_id','service_date','day_of_week','normal_owner_slot_id','coverer_slot_id','coverage_purpose','coverage_start','coverage_end','check_deadline_policy','creates_deep_clean','proximity_evidence','segments']
    ||case when responsibility ? 'normal_owner_capacity_id' then array['normal_owner_capacity_id'] else array['normal_owner_person_id'] end
    ||case when responsibility ? 'coverer_capacity_id' then array['coverer_capacity_id'] else array['coverer_person_id'] end,
   array['responsibility_id','loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','normal_owner_capacity_id','coverer_slot_id','coverer_person_id','coverer_capacity_id','coverage_purpose','coverage_start','coverage_end','check_deadline_policy','creates_deep_clean','proximity_evidence','segments'],'lunch responsibility');
  select value into loan from jsonb_array_elements(p_document->'loans') where value->>'loan_id'=responsibility->>'loan_id';
  if not found or loan->>'status'<>'PLANNED' then raise exception 'lunch responsibility has no planned loan'; end if;
  foreach identity_key in array array['service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','coverage_start','coverage_end'] loop
   if responsibility->identity_key is distinct from loan->identity_key then raise exception 'lunch responsibility scope mismatch'; end if;
  end loop;
  select value into helper from jsonb_array_elements(projection_availability)
   where value->>'slotId'=responsibility->>'coverer_slot_id' and value->>'serviceDate'=responsibility->>'service_date';
  if not found or helper->>'incumbentPersonId' is distinct from responsibility->>'coverer_person_id'
   or not (loan->'helper_slot_ids' ? (responsibility->>'coverer_slot_id'))
   or coalesce(responsibility->>'responsibility_id','') !~ '^[0-9a-f]{64}$'
   or responsibility->>'coverage_purpose' is distinct from 'lunch_coverage'
   or responsibility->>'check_deadline_policy' is distinct from 'inherit_existing_90_minute_deadline'
   or responsibility->'creates_deep_clean' is distinct from 'false'::jsonb
   or jsonb_typeof(responsibility->'segments') is distinct from 'array'
   or jsonb_array_length(responsibility->'segments')=0 then raise exception 'lunch responsibility policy or recipient mismatch'; end if;
  for segment in select value from jsonb_array_elements(responsibility->'segments') loop
   perform public.static_weekly_assert_exact_object(segment,
    array['planWorkId','workId','serviceMode','window','includedLocations']||case when full_hour then array['normalWindow'] else array[]::text[] end,
    array['planWorkId','workId','serviceMode','window','includedLocations']||case when full_hour then array['normalWindow'] else array[]::text[] end,'lunch segment');
   select value into base_work from jsonb_array_elements(projection_assignments)
    where value->>'plan_work_id'=segment->>'planWorkId' and value->>'service_date'=responsibility->>'service_date';
   if not found or base_work->>'status' is distinct from 'assigned'
    or base_work->>'owner_slot_id' is distinct from responsibility->>'normal_owner_slot_id'
    or base_work->>'owner_person_id' is distinct from responsibility->>'normal_owner_person_id'
    or base_work->>'work_id' is distinct from segment->>'workId'
    or base_work#>'{work_snapshot,includedLocations}' is distinct from segment->'includedLocations'
    or base_work#>>'{work_snapshot,serviceMode}' is distinct from segment->>'serviceMode'
    or segment->>'serviceMode'='reminder_only' then raise exception 'borrowed area differs from original assignment'; end if;
   if not ((helper->'qualifications') @> (base_work#>'{work_snapshot,requiredQualifications}'))
    or ((base_work#>'{work_snapshot,restrictedSlotIds}') ? (responsibility->>'coverer_slot_id') and not (
      base_work#>>'{work_snapshot,locationCodeSnapshot}'='HERPETARIUM' and base_work->>'day_of_week'<>'1'
      and responsibility->>'coverer_slot_id'=(select v#>>'{slots,ALIJAH,slotId}' from (select c.owner_config v from public.static_weekly_approved_initial_baselines b join public.static_weekly_approved_template_catalog c using(template_id) join public.weekly_schedule_versions ver on ver.authority_source_id=b.source_id join public.weekly_schedule_publications pub using(version_id) where pub.publication_id=p_publication) cfg)))
    or exists(select 1 from jsonb_array_elements(segment->'includedLocations') location
      where helper->'restrictions' ? (location->>'locationId')) then
    raise exception 'lunch helper is restricted or unqualified for a borrowed area'; end if;
   perform public.static_weekly_v3_assert_window(segment->'window','borrowed area');
   normal_segment_window:=case when full_hour then segment->'normalWindow' else segment->'window' end;
   perform public.static_weekly_v3_assert_window(normal_segment_window,'original borrowed-area anchor');
   if (normal_segment_window->>'start')::time<>greatest((base_work#>>'{work_snapshot,window,start}')::time,(loan->>'coverage_start')::time)
    or (normal_segment_window->>'end')::time<>least((base_work#>>'{work_snapshot,window,end}')::time,(loan->>'coverage_end')::time) then
    raise exception 'borrowed-area window must be the exact normal-duty and lunch intersection'; end if;
   if full_hour then
    if segment->'window' is distinct from jsonb_build_object('start',loan->'coverage_start','end',loan->'coverage_end')
     then raise exception 'full lunch area must cover the entire accepted lunch';end if;
    select value into strict planned_loan from jsonb_array_elements(full_hour_policy->'loans')
     where value->'dayOfWeek'=loan->'day_of_week' and value->'normalOwnerSlotId'=loan->'normal_owner_slot_id';
    if not exists(select 1 from jsonb_array_elements(planned_loan->'areas') area
     where area->>'locationCode'=base_work#>>'{work_snapshot,locationCodeSnapshot}'
      and area->'covererSlotId'=responsibility->'coverer_slot_id') then
     raise exception 'full lunch recipient differs from the immutable area plan';end if;
   end if;
  end loop;
 end loop;
 if full_hour then
  for planned_loan in select value from jsonb_array_elements(full_hour_policy->'loans') loop
   for segment in select value from jsonb_array_elements(planned_loan->'areas') loop
    perform public.static_weekly_assert_exact_object(segment,array['locationCode','covererSlotId'],array['locationCode','covererSlotId'],'full lunch source area');
    if jsonb_typeof(segment->'locationCode') is distinct from 'string' or length(segment->>'locationCode') not between 1 and 512
     or jsonb_typeof(segment->'covererSlotId') is distinct from 'string' or length(segment->>'covererSlotId') not between 1 and 512
     or segment->'covererSlotId'=planned_loan->'normalOwnerSlotId' then raise exception 'invalid full lunch source area';end if;
   end loop;
  end loop;
  select coalesce(jsonb_agg(entry order by entry::text),'[]') into expected from
   (select jsonb_build_array(l->'dayOfWeek',l->'normalOwnerSlotId',a->'locationCode',a->'covererSlotId') entry
    from jsonb_array_elements(full_hour_policy->'loans') l cross join lateral jsonb_array_elements(l->'areas') a) q;
  select coalesce(jsonb_agg(entry order by entry::text),'[]') into actual from
   (select distinct jsonb_build_array(r->'day_of_week',r->'normal_owner_slot_id',a#>'{work_snapshot,locationCodeSnapshot}',r->'coverer_slot_id') entry
    from jsonb_array_elements(p_document->'responsibilities') r cross join lateral jsonb_array_elements(r->'segments') s
    join jsonb_array_elements(projection_assignments) a on a->>'plan_work_id'=s->>'planWorkId'
     and a->'service_date'=r->'service_date') q;
  if expected is distinct from actual then raise exception 'full lunch source areas omitted, duplicated or reassigned';end if;
  if exists(with areas as materialized (
    select r->>'service_date' service_date,loc->>'locationId' location_id,
     jsonb_build_array(r->'coverer_slot_id',r->'coverer_person_id',r->'coverer_capacity_id') recipient,
     (s#>>'{window,start}')::time starts,(s#>>'{window,end}')::time ends
    from jsonb_array_elements(p_document->'responsibilities') r cross join lateral jsonb_array_elements(r->'segments') s
     cross join lateral jsonb_array_elements(s->'includedLocations') loc)
   select 1 from areas a join areas b on a.service_date=b.service_date and a.location_id=b.location_id
    and a.recipient is distinct from b.recipient and a.starts<b.ends and b.starts<a.ends) then
   raise exception 'full lunch plans conflict on current physical responsibility';end if;
 end if;
 -- Account for every normal flexible duty that intersects each scheduled lunch.
 select coalesce(jsonb_agg(jsonb_build_array(l->>'loan_id',a->>'plan_work_id')
  order by l->>'loan_id',a->>'plan_work_id'),'[]') into expected
 from jsonb_array_elements(p_document->'loans') l
 join jsonb_array_elements(projection_assignments) a
  on a->>'service_date'=l->>'service_date' and a->>'owner_slot_id'=l->>'normal_owner_slot_id'
 join jsonb_array_elements(projection_work) w
  on w->>'workId'=a->>'work_id' and w->>'dayOfWeek'=a->>'day_of_week'
 where a->>'status'='assigned' and w->>'schedulingMode'='flexible_coverage_ownership'
  and w->>'serviceMode'<>'reminder_only'
  and (a#>>'{work_snapshot,window,start}')::time<(l->>'coverage_end')::time
  and (l->>'coverage_start')::time<(a#>>'{work_snapshot,window,end}')::time;
 select coalesce(jsonb_agg(jsonb_build_array(r->>'loan_id',s->>'planWorkId')
  order by r->>'loan_id',s->>'planWorkId'),'[]') into actual
 from jsonb_array_elements(p_document->'responsibilities') r cross join lateral jsonb_array_elements(r->'segments') s;
 if actual is distinct from expected then raise exception 'lunch responsibility must cover every eligible original area exactly once'; end if;
 if exists(select 1 from jsonb_array_elements(p_document->'responsibilities') r,
  jsonb_array_elements(r->'segments') s group by r->>'loan_id',s->>'planWorkId' having count(*)>1) then
  raise exception 'borrowed work assigned more than once'; end if;
 if exists(select 1 from jsonb_array_elements(p_document->'responsibilities') r,
  jsonb_array_elements(r->'segments') s,jsonb_array_elements(s->'includedLocations') location
  group by r->>'loan_id',location->>'locationId' having count(distinct r->>'coverer_slot_id')>1) then
  raise exception 'paired or grouped locations split between lunch helpers'; end if;
 for intent in select value from jsonb_array_elements(p_document->'notification_intents') loop
  perform public.static_weekly_assert_exact_object(intent,
   array['notification_key','loan_id','service_date','event','scheduled_time','coverer_slot_id','delivery_state'],
   array['notification_key','loan_id','service_date','event','scheduled_time','coverer_slot_id','delivery_state'],'lunch notification intent');
  if coalesce(intent->>'notification_key','') !~ '^[0-9a-f]{64}$'
   or intent->>'delivery_state' is distinct from 'NOT_ENQUEUED' then raise exception 'invalid lunch notification intent'; end if;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_array(l->>'loan_id',l->>'service_date',h,e,
  case e when 'start' then l->>'coverage_start' else l->>'coverage_end' end) order by l->>'loan_id',h,e),'[]') into expected
 from jsonb_array_elements(p_document->'loans') l cross join lateral jsonb_array_elements_text(l->'helper_slot_ids') h
 cross join unnest(array['start','end']) e
 where exists(select 1 from jsonb_array_elements(projection_availability) a
  where a->>'slotId'=h and a->>'serviceDate'=l->>'service_date' and nullif(a->>'incumbentPersonId','') is not null);
 select coalesce(jsonb_agg(jsonb_build_array(n->>'loan_id',n->>'service_date',n->>'coverer_slot_id',n->>'event',n->>'scheduled_time')
  order by n->>'loan_id',n->>'coverer_slot_id',n->>'event'),'[]') into actual
 from jsonb_array_elements(p_document->'notification_intents') n;
 if actual is distinct from expected then raise exception 'lunch start/end intents must exactly cover every helper'; end if;
 if exists(select 1 from jsonb_array_elements(p_document->'loans') a join jsonb_array_elements(p_document->'loans') b
  on a->>'loan_id'<b->>'loan_id' and a->'service_date'=b->'service_date' and a->'helper_slot_ids'=b->'helper_slot_ids'
  and a->>'coverage_start'<b->>'coverage_end' and b->>'coverage_start'<a->>'coverage_end') then raise exception 'Manual native helper appointments overlap';end if;
 perform public.static_weekly_manual_assert_lunch_lineage(p_envelope,p_document,p_publication,p_week);
end $function$;
revoke all on function public.static_weekly_manual_assert_native_lunch(uuid,jsonb,jsonb,uuid,date) from public,anon,authenticated,service_role,static_weekly_release_operator,static_weekly_control_plane,custodial_application_reader;
CREATE OR REPLACE FUNCTION public.static_weekly_pending_assert_projection(p_operation uuid, p_manager uuid, p_envelope jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE ctx jsonb;c public.static_weekly_staffing_commands%rowtype;snapshot jsonb;source jsonb;before_source jsonb;
 publication uuid;week date;date date;expected_dates jsonb;part jsonb;proof jsonb;first_projection jsonb;chosen jsonb;
 expected_rows jsonb:='[]';expected_availability jsonb:='[]';expected_work jsonb:='[]';links jsonb:='{}';item jsonb;
 basis jsonb;first_basis jsonb;summary jsonb;effective jsonb;actual jsonb;expected jsonb;
BEGIN
 IF p_envelope#>>'{semantic_snapshot,schema}'='custodial.approved-manual-pending-staffing-snapshot.v1' THEN
  RETURN public.static_weekly_manual_assert_native_projection(p_operation,p_manager,p_envelope);END IF;
 ctx:=public.static_weekly_pending_context(p_operation,p_manager);
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation;
 PERFORM public.static_weekly_assert_exact_object(p_envelope,
  ARRAY['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','semantic_snapshot','database_projection_identity'],
  ARRAY['adapter','service_date','week_start','week_end','authority','receipt','authority_digest','replay_digest','compiler_version','objective','metrics','applied_exceptions','assignments','semantic_snapshot','database_projection_identity'],'pending projection');
 snapshot:=p_envelope->'semantic_snapshot';
 PERFORM public.static_weekly_assert_exact_object(snapshot,
  ARRAY['schema','originalCommand','originalSource','scopeDates','weekStart','generation','templateCatalogDigest','templateInputsDigest','partitions'],
  ARRAY['schema','originalCommand','originalSource','scopeDates','weekStart','generation','templateCatalogDigest','templateInputsDigest','partitions'],'pending original snapshot');
 IF snapshot->>'schema' IS DISTINCT FROM 'custodial.approved-static-pending-staffing-projection-snapshot.v1'
  OR snapshot->'originalCommand' IS DISTINCT FROM ctx->'originalCommand'
  OR coalesce(snapshot->>'weekStart','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 THEN RAISE EXCEPTION 'Pending original tuple differs';END IF;
 week:=(snapshot->>'weekStart')::date;
 IF NOT isfinite(week) OR extract(isodow FROM week)<>1 OR week>c.end_date OR week+6<c.start_date THEN RAISE EXCEPTION 'Pending original week differs';END IF;
 publication:=(snapshot#>>'{originalSource,publication_id}')::uuid;
 source:=public.static_weekly_v3_read_publication_source(publication,week);
 before_source:=jsonb_set(jsonb_set(source,'{authority_revision}',to_jsonb(c.expected_revision),false),'{exceptions}',
  public.static_weekly_pending_original_exception_set(publication,week,p_operation),false);
 IF snapshot->'originalSource' IS DISTINCT FROM before_source OR public.static_weekly_effective_version(week+6)::text IS DISTINCT FROM source->>'version_id'
 THEN RAISE EXCEPTION 'Pending original accepted Source differs';END IF;
 SELECT jsonb_agg(d::date::text ORDER BY d) INTO expected_dates
  FROM generate_series(greatest(c.start_date,week),least(c.end_date,week+6),'1 day') d;
 IF snapshot->'scopeDates' IS DISTINCT FROM expected_dates OR jsonb_typeof(snapshot->'partitions') IS DISTINCT FROM 'array'
  OR jsonb_array_length(snapshot->'partitions')<>jsonb_array_length(expected_dates)
 THEN RAISE EXCEPTION 'Pending complete original day partitions required';END IF;
 FOR part IN SELECT value FROM jsonb_array_elements(snapshot->'partitions') WITH ORDINALITY x(value,n) ORDER BY n LOOP
  PERFORM public.static_weekly_assert_exact_object(part,ARRAY['serviceDate','projection'],ARRAY['serviceDate','projection'],'pending day partition');
  IF jsonb_typeof(part->'serviceDate') IS DISTINCT FROM 'string' OR NOT(expected_dates ? (part->>'serviceDate'))
   OR (SELECT count(*) FROM jsonb_array_elements(snapshot->'partitions') p WHERE p->'serviceDate'=part->'serviceDate')<>1
   OR part#>'{projection,authority,scopeDates}' IS DISTINCT FROM jsonb_build_array(part->'serviceDate')
  THEN RAISE EXCEPTION 'Pending duplicate or foreign day partition';END IF;
  date:=(part->>'serviceDate')::date;
  basis:=public.static_weekly_read_approved_template_basis(p_manager,publication,date,'DATED_ABSENCE',NULL,
   CASE WHEN (ctx->>'afterFact')::boolean THEN c.expected_revision+1 ELSE c.expected_revision END);
  IF first_basis IS NULL THEN first_basis:=basis;END IF;
  IF basis->'generation' IS DISTINCT FROM snapshot->'generation'
   OR basis->'templateCatalogDigest' IS DISTINCT FROM snapshot->'templateCatalogDigest'
   OR basis->'templateInputsDigest' IS DISTINCT FROM snapshot->'templateInputsDigest'
   OR basis->'ownerConfig' IS DISTINCT FROM first_basis->'ownerConfig'
  THEN RAISE EXCEPTION 'Pending approved catalog config or generation differs';END IF;
  summary:=public.static_weekly_pending_applied_summary(p_operation,publication,week,date);
  proof:=public.static_weekly_pending_assert_day(p_operation,part->'projection',publication,week,summary);
  IF first_projection IS NULL THEN first_projection:=part->'projection';END IF;
 END LOOP;
 -- Deterministic disjoint composition: one source for every changed day and
 -- the exact same original six-day rows for every component's unaffected day.
 FOR date IN SELECT generate_series(week,week+6,'1 day')::date LOOP
  SELECT value->'projection' INTO chosen FROM jsonb_array_elements(snapshot->'partitions') WHERE value->>'serviceDate'=date::text;
  IF NOT FOUND THEN
   chosen:=first_projection;
   FOR part IN SELECT value FROM jsonb_array_elements(snapshot->'partitions') LOOP
    SELECT coalesce(jsonb_agg(r ORDER BY n),'[]') INTO actual FROM jsonb_array_elements(part#>'{projection,assignments}') WITH ORDINALITY x(r,n) WHERE r->>'service_date'=date::text;
    SELECT coalesce(jsonb_agg(r ORDER BY n),'[]') INTO expected FROM jsonb_array_elements(chosen->'assignments') WITH ORDINALITY x(r,n) WHERE r->>'service_date'=date::text;
    IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Pending unaffected original day changed';END IF;
   END LOOP;
  END IF;
  proof:=public.static_weekly_pending_assert_day(p_operation,chosen,publication,week,
   public.static_weekly_pending_applied_summary(p_operation,publication,week,(chosen#>>'{authority,scopeDates,0}')::date));
  SELECT expected_rows||coalesce(jsonb_agg(r ORDER BY n),'[]') INTO expected_rows FROM jsonb_array_elements(chosen->'assignments') WITH ORDINALITY x(r,n) WHERE r->>'service_date'=date::text;
  FOR item IN SELECT value FROM jsonb_array_elements(chosen->'assignments') WHERE value->>'service_date'=date::text LOOP
   links:=links||jsonb_build_object(item->>'plan_work_id',proof#>ARRAY['assignment_links',item->>'plan_work_id']);
  END LOOP;
  SELECT expected_availability||coalesce(jsonb_agg(r ORDER BY n),'[]') INTO expected_availability
   FROM jsonb_array_elements(chosen#>'{authority,projectionAvailability}') WITH ORDINALITY x(r,n) WHERE r->>'serviceDate'=date::text;
  SELECT expected_work||coalesce(jsonb_agg(r ORDER BY n),'[]') INTO expected_work
   FROM jsonb_array_elements(chosen#>'{authority,overlayCompilerInput,version,assignments}') WITH ORDINALITY x(r,n) WHERE r->>'dayOfWeek'=extract(dow FROM date)::text;
 END LOOP;
 SELECT jsonb_agg(r ORDER BY (r->>'dayOfWeek')::integer,r->>'slotId' COLLATE "C") INTO expected_availability FROM jsonb_array_elements(expected_availability) r;
 SELECT jsonb_agg(r ORDER BY (r->>'dayOfWeek')::integer,r->>'workId' COLLATE "C") INTO expected_work FROM jsonb_array_elements(expected_work) r;
 effective:=jsonb_set(jsonb_set(first_projection#>'{authority,overlayCompilerInput}','{version,assignments}',expected_work,false),
  '{exceptions}',public.static_weekly_pending_exception_set(p_operation,publication,week,NULL),false);
 expected:=jsonb_build_object('schema','custodial.approved-static-pending-staffing-authority.v1','effectiveDate',week,
  'compilerInput',first_projection#>'{authority,compilerInput}','overlayCompilerInput',effective,
  'inputDigest',public.static_weekly_digest_jsonb(effective),'projectionAvailability',expected_availability,'solverInvoked',false,'optimized',false);
 IF p_envelope->'assignments' IS DISTINCT FROM expected_rows OR p_envelope->'authority' IS DISTINCT FROM expected
  OR p_envelope->>'authority_digest' IS DISTINCT FROM public.static_weekly_digest_jsonb(expected)
  OR p_envelope->>'database_projection_identity' IS DISTINCT FROM public.static_weekly_digest_jsonb(p_envelope-'database_projection_identity')
  OR p_envelope->'adapter' IS DISTINCT FROM '{"schema":"custodial.approved-static-pending-staffing-adapter.v1","version":"approved-static-pending-staffing-v1"}'::jsonb
  OR p_envelope->>'compiler_version' IS DISTINCT FROM 'approved-static-pending-staffing-v1'
  OR p_envelope->>'week_start' IS DISTINCT FROM week::text OR p_envelope->>'service_date' IS DISTINCT FROM week::text
  OR p_envelope->>'week_end' IS DISTINCT FROM (week+6)::text
  OR p_envelope->'objective' IS DISTINCT FROM '{"contract":"FIXED_APPROVED_PENDING_STAFFING_NOT_OPTIMALITY"}'::jsonb
  OR p_envelope->'applied_exceptions' IS DISTINCT FROM public.static_weekly_pending_applied_summary(p_operation,publication,week,NULL)
 THEN RAISE EXCEPTION 'Pending merged exact week projection or original relation differs';END IF;
 PERFORM public.static_weekly_assert_exact_object(p_envelope->'receipt',
  ARRAY['schema','hardConstraintCount','hardConstraintDigest','solverInvoked','optimized'],
  ARRAY['schema','hardConstraintCount','hardConstraintDigest','solverInvoked','optimized'],'pending fixed feasibility DATA');
 IF p_envelope#>>'{receipt,schema}' IS DISTINCT FROM 'custodial.approved-static-pending-feasibility.v1'
  OR p_envelope#>'{receipt,solverInvoked}' IS DISTINCT FROM 'false'::jsonb OR p_envelope#>'{receipt,optimized}' IS DISTINCT FROM 'false'::jsonb
  OR jsonb_typeof(p_envelope#>'{receipt,hardConstraintCount}') IS DISTINCT FROM 'number'
  OR (p_envelope#>>'{receipt,hardConstraintCount}')::numeric NOT BETWEEN jsonb_array_length(expected_rows) AND 100000
  OR (p_envelope#>>'{receipt,hardConstraintCount}')::numeric<>trunc((p_envelope#>>'{receipt,hardConstraintCount}')::numeric)
  OR coalesce(p_envelope#>>'{receipt,hardConstraintDigest}','')!~'^[0-9a-f]{64}$'
  OR coalesce(p_envelope->>'replay_digest','')!~'^[0-9a-f]{64}$'
  OR p_envelope->'metrics' IS DISTINCT FROM jsonb_build_object('hardConstraints',p_envelope#>'{receipt,hardConstraintCount}','violations',0)
 THEN RAISE EXCEPTION 'Pending fixed feasibility DATA malformed';END IF;
 IF (ctx->>'afterFact')::boolean AND public.static_weekly_pending_summary(p_operation,publication,week,NULL)
  IS DISTINCT FROM public.static_weekly_accepted_exception_set(publication,week)
 THEN RAISE EXCEPTION 'Pending original semantics did not become the exact accepted facts';END IF;
 IF public.static_weekly_pending_context(p_operation,p_manager) IS DISTINCT FROM ctx THEN RAISE EXCEPTION 'Pending native context changed';END IF;
 RETURN jsonb_build_object('assignment_links',links,'projection_assignments',expected_rows,'afterFact',ctx->'afterFact');
END $function$;
CREATE OR REPLACE FUNCTION public.static_weekly_pending_assert_lunch(p_operation uuid, p_manager uuid, p_publication uuid, p_week date, p_envelope jsonb, p_document jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 PERFORM public.static_weekly_pending_assert_projection(p_operation,p_manager,p_envelope);
 IF p_envelope#>>'{semantic_snapshot,originalSource,publication_id}' IS DISTINCT FROM p_publication::text
  OR p_envelope->>'week_start' IS DISTINCT FROM p_week::text THEN RAISE EXCEPTION 'Pending lunch original publication or week differs';END IF;
 IF p_envelope->>'replay_digest' IS DISTINCT FROM public.static_weekly_digest_jsonb(jsonb_build_object(
  'projectionAssignments',p_envelope->'assignments','lunchDocument',p_document-ARRAY['base_authority_digest','base_replay_digest','document_identity']))
 THEN RAISE EXCEPTION 'Pending complete merged lunch replay differs';END IF;
 IF p_envelope#>>'{semantic_snapshot,schema}'='custodial.approved-manual-pending-staffing-snapshot.v1' THEN
  PERFORM public.static_weekly_manual_assert_native_lunch(NULL,p_document,p_envelope,p_publication,p_week);
 ELSE PERFORM public.static_weekly_pending_lunch_derivation(NULL,p_document,p_envelope,p_publication,p_week,p_operation);END IF;
END $function$;
CREATE OR REPLACE FUNCTION public.static_weekly_v8_assert_lunch_document(p_projection_id uuid, p_document jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
 projection public.weekly_schedule_compiled_projections%rowtype;
 loan jsonb;responsibility jsonb;segment jsonb;intent jsonb;availability jsonb;helper jsonb;
 base_work jsonb;expected jsonb;actual jsonb;helper_id text;identity_key text;
 start_time time;end_time time;
 projection_availability jsonb;projection_assignments jsonb;projection_work jsonb;
 full_hour_policy jsonb;full_hour boolean;planned_loan jsonb;normal_segment_window jsonb;
begin
 perform public.static_weekly_assert_exact_object(p_document,
  array['schema','persistence_authority','verification_status','week_start','base_authority_digest','base_replay_digest','source_input_digest','candidate_digest','loans','responsibilities','notification_intents','semantic_snapshot','document_identity'],
  array['schema','persistence_authority','verification_status','week_start','base_authority_digest','base_replay_digest','source_input_digest','candidate_digest','loans','responsibilities','notification_intents','semantic_snapshot','document_identity'],'lunch document');
 select * into projection from public.weekly_schedule_compiled_projections where projection_id=p_projection_id;
 if not found then raise exception 'lunch projection is missing'; end if;
 if projection.projection_envelope#>>'{adapter,schema}'='custodial.approved-manual-period-database-adapter.v1' then
  perform public.static_weekly_manual_assert_native_lunch(p_projection_id,p_document,projection.projection_envelope,projection.publication_id,projection.week_start);return;end if;

 projection_availability:=projection.projection_envelope#>'{authority,projectionAvailability}';
 projection_assignments:=projection.projection_envelope->'assignments';
 projection_work:=projection.projection_envelope#>'{authority,overlayCompilerInput,version,assignments}';
 full_hour_policy:=projection.projection_envelope#>'{authority,compilerInput,version,lunchCoveragePolicy}';
 full_hour:=full_hour_policy is not null;
 if projection.projection_envelope#>'{authority,overlayCompilerInput,version,lunchCoveragePolicy}'
   is distinct from full_hour_policy then raise exception 'full lunch policy changed during projection';end if;
 if full_hour then
  perform public.static_weekly_assert_exact_object(full_hour_policy,
   array['schema','sourceDigest','loans','policyDigest'],array['schema','sourceDigest','loans','policyDigest'],'full lunch policy');
  if full_hour_policy->>'schema' is distinct from 'memphis-zoo.static-weekly-full-hour-lunch-policy.v1'
   or jsonb_typeof(full_hour_policy->'sourceDigest') is distinct from 'string'
   or coalesce(full_hour_policy->>'sourceDigest','') !~ '^[0-9a-f]{64}$'
   or full_hour_policy->>'policyDigest' is distinct from public.static_weekly_digest_jsonb(full_hour_policy-'policyDigest')
   or jsonb_typeof(full_hour_policy->'loans') is distinct from 'array'
   or jsonb_array_length(full_hour_policy->'loans')>1792 then raise exception 'invalid full lunch source policy';end if;
  for planned_loan in select value from jsonb_array_elements(full_hour_policy->'loans') loop
   perform public.static_weekly_assert_exact_object(planned_loan,
    array['dayOfWeek','normalOwnerSlotId','window','areas'],array['dayOfWeek','normalOwnerSlotId','window','areas'],'full lunch source loan');
   perform public.static_weekly_v3_assert_window(planned_loan->'window','full lunch source window');
   if jsonb_typeof(planned_loan->'dayOfWeek') is distinct from 'number'
    or (planned_loan->>'dayOfWeek') !~ '^[0-6]$'
    or jsonb_typeof(planned_loan->'normalOwnerSlotId') is distinct from 'string'
    or length(planned_loan->>'normalOwnerSlotId') not between 1 and 512
    or jsonb_typeof(planned_loan->'areas') is distinct from 'array'
    or jsonb_array_length(planned_loan->'areas')>128 then raise exception 'invalid full lunch source owner or areas';end if;
  end loop;
  select coalesce(jsonb_agg(entry order by entry::text),'[]') into expected from
   (select jsonb_build_array(value->'dayOfWeek',value->'normalOwnerSlotId') entry
    from jsonb_array_elements(full_hour_policy->'loans')) q;
  select coalesce(jsonb_agg(entry order by entry::text),'[]') into actual from
   (select jsonb_build_array(value->'day_of_week',value->'normal_owner_slot_id') entry
    from jsonb_array_elements(p_document->'loans')) q;
  if expected is distinct from actual then raise exception 'full lunch source owner set changed';end if;
 end if;

 if p_document->>'schema' is distinct from 'memphis-zoo.static-weekly-lunch-authority-document.v1'
  or p_document->>'persistence_authority' is distinct from 'NOT_PERSISTED'
  or p_document->>'verification_status' is distinct from 'VERIFIED'
  or p_document->>'week_start' is distinct from projection.week_start::text
  or p_document->>'base_authority_digest' is distinct from projection.authority_digest
  or p_document->>'base_replay_digest' is distinct from projection.replay_digest
  or p_document->>'source_input_digest' is distinct from projection.projection_envelope#>>'{authority,inputDigest}'
  or coalesce(p_document->>'candidate_digest','') !~ '^[0-9a-f]{64}$'
  or p_document->>'document_identity' is distinct from public.static_weekly_digest_jsonb(p_document-'document_identity') then
  raise exception 'lunch document is not bound to the exact verified projection';
 end if;
 foreach identity_key in array array['loans','responsibilities','notification_intents'] loop
  if jsonb_typeof(p_document->identity_key) is distinct from 'array'
   or jsonb_array_length(p_document->identity_key)>4096 then raise exception 'lunch document array invalid'; end if;
 end loop;
 expected:=jsonb_build_object('schema','memphis-zoo.static-weekly-lunch-semantic-snapshot.v1',
  'loans_digest',public.static_weekly_digest_jsonb(p_document->'loans'),
  'responsibilities_digest',public.static_weekly_digest_jsonb(p_document->'responsibilities'),
  'notification_intents_digest',public.static_weekly_digest_jsonb(p_document->'notification_intents'));
 if p_document->'semantic_snapshot' is distinct from expected then raise exception 'lunch semantic snapshot mismatch'; end if;
 if (select count(*)<>count(distinct value->>'loan_id') from jsonb_array_elements(p_document->'loans'))
 or (select count(*)<>count(distinct value->>'responsibility_id') from jsonb_array_elements(p_document->'responsibilities'))
 or (select count(*)<>count(distinct value->>'notification_key') from jsonb_array_elements(p_document->'notification_intents')) then
  raise exception 'duplicate or missing lunch record identity'; end if;
 select coalesce(jsonb_agg(jsonb_build_array(value->>'serviceDate',value->>'slotId') order by value->>'serviceDate',value->>'slotId'),'[]')
 into expected from jsonb_array_elements(projection_availability)
 where value->>'status'='working' and (nullif(value->>'incumbentPersonId','') is not null or value->>'ownerKind'='CONTRACTOR_CAPACITY')
  and (value->>'ownerKind'='CONTRACTOR_CAPACITY' and value->>'breakChoice'='NONE' and value->'lunch'='null'::jsonb) is not true;
 select coalesce(jsonb_agg(jsonb_build_array(value->>'service_date',value->>'normal_owner_slot_id') order by value->>'service_date',value->>'normal_owner_slot_id'),'[]')
 into actual from jsonb_array_elements(p_document->'loans');
 if actual is distinct from expected then raise exception 'lunch coverage omits or duplicates a working owner'; end if;
 for loan in select value from jsonb_array_elements(p_document->'loans') loop
  perform public.static_weekly_capacity_assert_lunch_party(p_projection_id,loan,'normal_owner');
  perform public.static_weekly_assert_exact_object(loan,
   case when loan ? 'normal_owner_capacity_id' then array['loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_capacity_id','coverage_start','coverage_end','status','helper_slot_ids']
    else array['loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','coverage_start','coverage_end','status','helper_slot_ids'] end,
   array['loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','normal_owner_capacity_id','coverage_start','coverage_end','status','reason','helper_slot_ids','fallback','total_distance_minutes'],'lunch loan');
  if not (loan ?& array['reason','fallback','total_distance_minutes']) then raise exception 'lunch explanatory fields are missing'; end if;
  if coalesce(loan->>'loan_id','') !~ '^[0-9a-f]{64}$' then raise exception 'invalid lunch loan identity'; end if;
  select value into availability from jsonb_array_elements(projection_availability)
   where value->>'slotId'=loan->>'normal_owner_slot_id' and value->>'serviceDate'=loan->>'service_date';
  if not found or availability->>'incumbentPersonId' is distinct from loan->>'normal_owner_person_id'
   or loan->'day_of_week' is distinct from availability->'dayOfWeek'
   or loan->>'coverage_start' is distinct from availability#>>'{lunch,start}'
   or loan->>'coverage_end' is distinct from availability#>>'{lunch,end}' then raise exception 'lunch owner or scheduled hour mismatch'; end if;
  perform public.static_weekly_v3_assert_window(jsonb_build_object('start',loan->'coverage_start','end',loan->'coverage_end'),'lunch');
  start_time:=(loan->>'coverage_start')::time;end_time:=(loan->>'coverage_end')::time;
  if end_time<=start_time then raise exception 'accepted lunch end must follow its start'; end if;
  perform public.static_weekly_v3_assert_string_array(loan->'helper_slot_ids','lunch helpers');
  if ((loan->>'status'='NO_AREAS' and jsonb_array_length(loan->'helper_slot_ids')=0 and loan->'fallback'='null'::jsonb)
    or (loan->>'status'='PLANNED' and (
      (full_hour and jsonb_array_length(loan->'helper_slot_ids') between 1 and 2
        and (loan->'fallback'='null'::jsonb or (jsonb_array_length(loan->'helper_slot_ids')=1 and loan->>'fallback'='only_one_eligible_custodian')))
      or (not full_hour and ((jsonb_array_length(loan->'helper_slot_ids')=2 and loan->'fallback'='null'::jsonb)
        or (jsonb_array_length(loan->'helper_slot_ids')=1 and loan->>'fallback'='only_one_eligible_custodian')))))) is not true then
   raise exception 'lunch helper cardinality or fallback invalid'; end if;
  if full_hour then
   select value into strict planned_loan from jsonb_array_elements(full_hour_policy->'loans')
    where value->'dayOfWeek'=loan->'day_of_week' and value->'normalOwnerSlotId'=loan->'normal_owner_slot_id';
   if planned_loan->'window' is distinct from jsonb_build_object('start',loan->'coverage_start','end',loan->'coverage_end')
    then raise exception 'full lunch source window changed';end if;
   if loan->'helper_slot_ids' is distinct from (
     select coalesce(jsonb_agg(coverer order by coverer collate "C"),'[]'::jsonb)
     from (select distinct area->>'covererSlotId' coverer
       from jsonb_array_elements(planned_loan->'areas') area) named)
    then raise exception 'full lunch source coverer set changed';end if;
  end if;
  for helper_id in select jsonb_array_elements_text(loan->'helper_slot_ids') loop
   select value into helper from jsonb_array_elements(projection_availability)
    where value->>'slotId'=helper_id and value->>'serviceDate'=loan->>'service_date';
   if not found or helper->>'status' is distinct from 'working' or helper_id=loan->>'normal_owner_slot_id'
    or (nullif(helper->>'incumbentPersonId','') is null and helper->>'ownerKind' is distinct from 'CONTRACTOR_CAPACITY')
    or ((helper#>>'{lunch,start}' is null or helper#>>'{lunch,end}' is null)
      and (helper->>'ownerKind'='CONTRACTOR_CAPACITY' and helper->>'breakChoice'='NONE' and helper->'lunch'='null'::jsonb) is not true) or (helper#>>'{shift,start}')::time>start_time
    or (helper#>>'{shift,end}')::time<end_time
    or ((helper#>>'{lunch,start}')::time<end_time and start_time<(helper#>>'{lunch,end}')::time) then
    raise exception 'lunch helper is not available for the full scheduled hour'; end if;
   if not exists(select 1 from jsonb_array_elements(p_document->'responsibilities') r
     where r->>'loan_id'=loan->>'loan_id' and r->>'coverer_slot_id'=helper_id) then
    raise exception 'lunch helper has no assigned responsibility'; end if;
  end loop;
 end loop;
 for responsibility in select value from jsonb_array_elements(p_document->'responsibilities') loop
  perform public.static_weekly_capacity_assert_lunch_party(p_projection_id,responsibility,'normal_owner');
  perform public.static_weekly_capacity_assert_lunch_party(p_projection_id,responsibility,'coverer');
  perform public.static_weekly_assert_exact_object(responsibility,
   array['responsibility_id','loan_id','service_date','day_of_week','normal_owner_slot_id','coverer_slot_id','coverage_purpose','coverage_start','coverage_end','check_deadline_policy','creates_deep_clean','proximity_evidence','segments']
    ||case when responsibility ? 'normal_owner_capacity_id' then array['normal_owner_capacity_id'] else array['normal_owner_person_id'] end
    ||case when responsibility ? 'coverer_capacity_id' then array['coverer_capacity_id'] else array['coverer_person_id'] end,
   array['responsibility_id','loan_id','service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','normal_owner_capacity_id','coverer_slot_id','coverer_person_id','coverer_capacity_id','coverage_purpose','coverage_start','coverage_end','check_deadline_policy','creates_deep_clean','proximity_evidence','segments'],'lunch responsibility');
  select value into loan from jsonb_array_elements(p_document->'loans') where value->>'loan_id'=responsibility->>'loan_id';
  if not found or loan->>'status'<>'PLANNED' then raise exception 'lunch responsibility has no planned loan'; end if;
  foreach identity_key in array array['service_date','day_of_week','normal_owner_slot_id','normal_owner_person_id','coverage_start','coverage_end'] loop
   if responsibility->identity_key is distinct from loan->identity_key then raise exception 'lunch responsibility scope mismatch'; end if;
  end loop;
  select value into helper from jsonb_array_elements(projection_availability)
   where value->>'slotId'=responsibility->>'coverer_slot_id' and value->>'serviceDate'=responsibility->>'service_date';
  if not found or helper->>'incumbentPersonId' is distinct from responsibility->>'coverer_person_id'
   or not (loan->'helper_slot_ids' ? (responsibility->>'coverer_slot_id'))
   or coalesce(responsibility->>'responsibility_id','') !~ '^[0-9a-f]{64}$'
   or responsibility->>'coverage_purpose' is distinct from 'lunch_coverage'
   or responsibility->>'check_deadline_policy' is distinct from 'inherit_existing_90_minute_deadline'
   or responsibility->'creates_deep_clean' is distinct from 'false'::jsonb
   or jsonb_typeof(responsibility->'segments') is distinct from 'array'
   or jsonb_array_length(responsibility->'segments')=0 then raise exception 'lunch responsibility policy or recipient mismatch'; end if;
  for segment in select value from jsonb_array_elements(responsibility->'segments') loop
   perform public.static_weekly_assert_exact_object(segment,
    array['planWorkId','workId','serviceMode','window','includedLocations']||case when full_hour then array['normalWindow'] else array[]::text[] end,
    array['planWorkId','workId','serviceMode','window','includedLocations']||case when full_hour then array['normalWindow'] else array[]::text[] end,'lunch segment');
   select value into base_work from jsonb_array_elements(projection_assignments)
    where value->>'plan_work_id'=segment->>'planWorkId' and value->>'service_date'=responsibility->>'service_date';
   if not found or base_work->>'status' is distinct from 'assigned'
    or base_work->>'owner_slot_id' is distinct from responsibility->>'normal_owner_slot_id'
    or base_work->>'owner_person_id' is distinct from responsibility->>'normal_owner_person_id'
    or base_work->>'work_id' is distinct from segment->>'workId'
    or base_work#>'{work_snapshot,includedLocations}' is distinct from segment->'includedLocations'
    or base_work#>>'{work_snapshot,serviceMode}' is distinct from segment->>'serviceMode'
    or segment->>'serviceMode'='reminder_only' then raise exception 'borrowed area differs from original assignment'; end if;
   if not ((helper->'qualifications') @> (base_work#>'{work_snapshot,requiredQualifications}'))
    or (base_work#>'{work_snapshot,restrictedSlotIds}') ? (responsibility->>'coverer_slot_id')
    or exists(select 1 from jsonb_array_elements(segment->'includedLocations') location
      where helper->'restrictions' ? (location->>'locationId')) then
    raise exception 'lunch helper is restricted or unqualified for a borrowed area'; end if;
   perform public.static_weekly_v3_assert_window(segment->'window','borrowed area');
   normal_segment_window:=case when full_hour then segment->'normalWindow' else segment->'window' end;
   perform public.static_weekly_v3_assert_window(normal_segment_window,'original borrowed-area anchor');
   if (normal_segment_window->>'start')::time<>greatest((base_work#>>'{work_snapshot,window,start}')::time,(loan->>'coverage_start')::time)
    or (normal_segment_window->>'end')::time<>least((base_work#>>'{work_snapshot,window,end}')::time,(loan->>'coverage_end')::time) then
    raise exception 'borrowed-area window must be the exact normal-duty and lunch intersection'; end if;
   if full_hour then
    if segment->'window' is distinct from jsonb_build_object('start',loan->'coverage_start','end',loan->'coverage_end')
     then raise exception 'full lunch area must cover the entire accepted lunch';end if;
    select value into strict planned_loan from jsonb_array_elements(full_hour_policy->'loans')
     where value->'dayOfWeek'=loan->'day_of_week' and value->'normalOwnerSlotId'=loan->'normal_owner_slot_id';
    if not exists(select 1 from jsonb_array_elements(planned_loan->'areas') area
     where area->>'locationCode'=base_work#>>'{work_snapshot,locationCodeSnapshot}'
      and area->'covererSlotId'=responsibility->'coverer_slot_id') then
     raise exception 'full lunch recipient differs from the immutable area plan';end if;
   end if;
  end loop;
 end loop;
 if full_hour then
  for planned_loan in select value from jsonb_array_elements(full_hour_policy->'loans') loop
   for segment in select value from jsonb_array_elements(planned_loan->'areas') loop
    perform public.static_weekly_assert_exact_object(segment,array['locationCode','covererSlotId'],array['locationCode','covererSlotId'],'full lunch source area');
    if jsonb_typeof(segment->'locationCode') is distinct from 'string' or length(segment->>'locationCode') not between 1 and 512
     or jsonb_typeof(segment->'covererSlotId') is distinct from 'string' or length(segment->>'covererSlotId') not between 1 and 512
     or segment->'covererSlotId'=planned_loan->'normalOwnerSlotId' then raise exception 'invalid full lunch source area';end if;
   end loop;
  end loop;
  select coalesce(jsonb_agg(entry order by entry::text),'[]') into expected from
   (select jsonb_build_array(l->'dayOfWeek',l->'normalOwnerSlotId',a->'locationCode',a->'covererSlotId') entry
    from jsonb_array_elements(full_hour_policy->'loans') l cross join lateral jsonb_array_elements(l->'areas') a) q;
  select coalesce(jsonb_agg(entry order by entry::text),'[]') into actual from
   (select distinct jsonb_build_array(r->'day_of_week',r->'normal_owner_slot_id',a#>'{work_snapshot,locationCodeSnapshot}',r->'coverer_slot_id') entry
    from jsonb_array_elements(p_document->'responsibilities') r cross join lateral jsonb_array_elements(r->'segments') s
    join jsonb_array_elements(projection_assignments) a on a->>'plan_work_id'=s->>'planWorkId'
     and a->'service_date'=r->'service_date') q;
  if expected is distinct from actual then raise exception 'full lunch source areas omitted, duplicated or reassigned';end if;
  if exists(with areas as materialized (
    select r->>'service_date' service_date,loc->>'locationId' location_id,
     jsonb_build_array(r->'coverer_slot_id',r->'coverer_person_id',r->'coverer_capacity_id') recipient,
     (s#>>'{window,start}')::time starts,(s#>>'{window,end}')::time ends
    from jsonb_array_elements(p_document->'responsibilities') r cross join lateral jsonb_array_elements(r->'segments') s
     cross join lateral jsonb_array_elements(s->'includedLocations') loc)
   select 1 from areas a join areas b on a.service_date=b.service_date and a.location_id=b.location_id
    and a.recipient is distinct from b.recipient and a.starts<b.ends and b.starts<a.ends) then
   raise exception 'full lunch plans conflict on current physical responsibility';end if;
 end if;
 -- Account for every normal flexible duty that intersects each scheduled lunch.
 select coalesce(jsonb_agg(jsonb_build_array(l->>'loan_id',a->>'plan_work_id')
  order by l->>'loan_id',a->>'plan_work_id'),'[]') into expected
 from jsonb_array_elements(p_document->'loans') l
 join jsonb_array_elements(projection_assignments) a
  on a->>'service_date'=l->>'service_date' and a->>'owner_slot_id'=l->>'normal_owner_slot_id'
 join jsonb_array_elements(projection_work) w
  on w->>'workId'=a->>'work_id' and w->>'dayOfWeek'=a->>'day_of_week'
 where a->>'status'='assigned' and w->>'schedulingMode'='flexible_coverage_ownership'
  and w->>'serviceMode'<>'reminder_only'
  and (a#>>'{work_snapshot,window,start}')::time<(l->>'coverage_end')::time
  and (l->>'coverage_start')::time<(a#>>'{work_snapshot,window,end}')::time;
 select coalesce(jsonb_agg(jsonb_build_array(r->>'loan_id',s->>'planWorkId')
  order by r->>'loan_id',s->>'planWorkId'),'[]') into actual
 from jsonb_array_elements(p_document->'responsibilities') r cross join lateral jsonb_array_elements(r->'segments') s;
 if actual is distinct from expected then raise exception 'lunch responsibility must cover every eligible original area exactly once'; end if;
 if exists(select 1 from jsonb_array_elements(p_document->'responsibilities') r,
  jsonb_array_elements(r->'segments') s group by r->>'loan_id',s->>'planWorkId' having count(*)>1) then
  raise exception 'borrowed work assigned more than once'; end if;
 if exists(select 1 from jsonb_array_elements(p_document->'responsibilities') r,
  jsonb_array_elements(r->'segments') s,jsonb_array_elements(s->'includedLocations') location
  group by r->>'loan_id',location->>'locationId' having count(distinct r->>'coverer_slot_id')>1) then
  raise exception 'paired or grouped locations split between lunch helpers'; end if;
 for intent in select value from jsonb_array_elements(p_document->'notification_intents') loop
  perform public.static_weekly_assert_exact_object(intent,
   array['notification_key','loan_id','service_date','event','scheduled_time','coverer_slot_id','delivery_state'],
   array['notification_key','loan_id','service_date','event','scheduled_time','coverer_slot_id','delivery_state'],'lunch notification intent');
  if coalesce(intent->>'notification_key','') !~ '^[0-9a-f]{64}$'
   or intent->>'delivery_state' is distinct from 'NOT_ENQUEUED' then raise exception 'invalid lunch notification intent'; end if;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_array(l->>'loan_id',l->>'service_date',h,e,
  case e when 'start' then l->>'coverage_start' else l->>'coverage_end' end) order by l->>'loan_id',h,e),'[]') into expected
 from jsonb_array_elements(p_document->'loans') l cross join lateral jsonb_array_elements_text(l->'helper_slot_ids') h
 cross join unnest(array['start','end']) e
 where exists(select 1 from jsonb_array_elements(projection_availability) a
  where a->>'slotId'=h and a->>'serviceDate'=l->>'service_date' and nullif(a->>'incumbentPersonId','') is not null);
 select coalesce(jsonb_agg(jsonb_build_array(n->>'loan_id',n->>'service_date',n->>'coverer_slot_id',n->>'event',n->>'scheduled_time')
  order by n->>'loan_id',n->>'coverer_slot_id',n->>'event'),'[]') into actual
 from jsonb_array_elements(p_document->'notification_intents') n;
 if actual is distinct from expected then raise exception 'lunch start/end intents must exactly cover every helper'; end if;
end $function$;
CREATE OR REPLACE FUNCTION public.static_weekly_pending_exception_set(p_operation uuid, p_publication uuid, p_week date, p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE c public.static_weekly_staffing_commands%rowtype;ctx jsonb;result jsonb;d date;slot uuid;version uuid;row jsonb;
BEGIN
 SELECT * INTO STRICT c FROM public.static_weekly_staffing_commands WHERE operation_id=p_operation;
 ctx:=public.static_weekly_pending_context(p_operation,c.prepared_by_manager_id);
 IF p_week IS NULL OR public.static_weekly_projection_window_start(p_week) IS DISTINCT FROM p_week OR p_week>c.end_date OR p_week+6<c.start_date
  OR p_day IS NOT NULL AND (p_day NOT BETWEEN greatest(p_week,c.start_date) AND least(p_week+6,c.end_date))
 THEN RAISE EXCEPTION 'Pending scope differs';END IF;
 SELECT version_id INTO STRICT version FROM public.weekly_schedule_publications WHERE publication_id=p_publication;
 IF public.static_weekly_effective_version(p_week)<>version OR public.static_weekly_effective_version(p_week+6)<>version
 THEN RAISE EXCEPTION 'Pending publication changed within week';END IF;
 result:=public.static_weekly_pending_original_exception_set(p_publication,p_week,p_operation);
 IF c.command_kind='cancel_absence' THEN
  SELECT coalesce(jsonb_agg(e ORDER BY n),'[]') INTO result FROM jsonb_array_elements(result) WITH ORDINALITY x(e,n)
   WHERE (e->>'staffingAbsenceId'=c.target_absence_id::text AND (e->>'serviceDate')::date BETWEEN c.start_date AND c.end_date
    AND (p_day IS NULL OR (e->>'serviceDate')::date=p_day)) IS NOT TRUE;
 ELSE
  FOR d IN SELECT generate_series(greatest(p_week,c.start_date),least(p_week+6,c.end_date),'1 day')::date LOOP
   IF p_day IS NOT NULL AND d<>p_day THEN CONTINUE;END IF;
   SELECT i.slot_id INTO STRICT slot FROM public.v_weekly_roster_slot_incumbency_ranges i WHERE i.person_id=c.employee_id
    AND i.effective_start<=d AND (i.effective_end IS NULL OR d<i.effective_end);
   row:=jsonb_build_object('id',c.operation_id::text||':'||d::text,'type',CASE WHEN c.absence_kind='pto' THEN 'pto' ELSE 'daily_absence' END,
    'serviceDate',d,'staffingAbsenceId',c.operation_id,'staffingAbsenceKind',c.absence_kind,'actorId',c.prepared_by_manager_id,
    'reason','Approved staffing unavailability','idempotencyKey','staffing:'||c.operation_id::text||':'||d::text,
    'expectedRevision',c.expected_revision,'payload',jsonb_build_object('slotId',slot),'baseVersionId',version,'publicationId',p_publication,
    'sequence',c.expected_revision+1+(d-c.start_date));
   -- No accepted/status flag is exported or trusted on this proposed fact.
   result:=result||jsonb_build_array(row);
  END LOOP;
 END IF;
 SELECT coalesce(jsonb_agg(e ORDER BY e->>'serviceDate',(e->>'sequence')::bigint,e->>'id' COLLATE "C"),'[]') INTO result FROM jsonb_array_elements(result) e;
 RETURN result;
END $function$;
CREATE OR REPLACE FUNCTION public.static_weekly_v10_stage_staffing_command(p_operation_id uuid, p_candidates jsonb, p_preview_digest text, p_input_digest text, p_publication_vector jsonb, p_manager_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_pending record;v_pending_lunch jsonb; actor jsonb;command public.static_weekly_staffing_commands%rowtype;
 v_candidate_set_digest text;v_candidate_rows integer;v_candidate_bytes bigint;v_week_count integer;
 v_projection_weeks integer;v_lunch_weeks integer;v_summary jsonb;v_receipt jsonb;v_current_revision bigint;
begin
 perform public.static_weekly_v3_assert_control_plane();
 actor:=public.static_weekly_v3_manager_actor(p_manager_id);
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into command from public.static_weekly_staffing_commands where operation_id=p_operation_id for update;
 if not found then raise exception using errcode='P0002',message='staffing command is unavailable';end if;
 if command.prepared_by_manager_id is distinct from p_manager_id then
  raise exception using errcode='42501',message='only the authenticated original preparer may stage this command';end if;
 if p_preview_digest is null or p_preview_digest!~'^[0-9a-f]{64}$'
  or p_input_digest is null or p_input_digest!~'^[0-9a-f]{64}$'
  or jsonb_typeof(p_publication_vector) is distinct from 'object'
  or jsonb_typeof(p_candidates) is distinct from 'array' then
  raise exception using errcode='22023',message='invalid staffing candidate envelope';end if;
 v_candidate_set_digest:=public.static_weekly_digest_jsonb(p_candidates);
 if command.state='PREPARED' then
  if command.candidate_set_digest is distinct from v_candidate_set_digest
   or command.preview_digest is distinct from p_preview_digest
   or command.input_digest is distinct from p_input_digest
   or command.publication_vector is distinct from p_publication_vector then
   raise exception using errcode='23505',message='prepared staffing operation was replayed with different candidates';end if;
  return jsonb_build_object('operation_id',command.operation_id,'state',command.state,
   'candidate_set_digest',command.candidate_set_digest,'candidate_row_count',command.candidate_row_count,
   'candidate_bytes',command.candidate_bytes,'candidate_summary',command.candidate_summary,'replayed',true);
 end if;
 if command.state<>'PREPARING' then raise exception using errcode='55000',message='staffing command cannot be staged from its current state';end if;
 select control.current_revision into v_current_revision from public.static_weekly_schedule_control control where control.singleton for share;
 if v_current_revision is distinct from command.expected_revision then
  raise exception using errcode='40001',message='staffing command expected revision became stale during preparation';end if;
 if command.command_kind='absence' and not exists(select 1 from public.employees where id=command.employee_id and active=true) then
  raise exception using errcode='23514',message='staffing command employee is no longer active';end if;
 if command.command_kind='cancel_absence' and command.start_date<public.sch_service_date(statement_timestamp()) then
  raise exception using errcode='23514',message='staffing cancellation cannot rewrite an elapsed service date during preparation';end if;
 if command.command_kind='cancel_absence' and not exists(
  select 1 from public.static_weekly_staffing_absences a
  join public.static_weekly_staffing_commands acceptedcmd
   on acceptedcmd.operation_id=a.accepted_operation_id and acceptedcmd.operation_id=a.absence_id
    and acceptedcmd.command_kind='absence' and acceptedcmd.state='ACCEPTED'
    and acceptedcmd.employee_id=a.employee_id and acceptedcmd.start_date=a.start_date and acceptedcmd.end_date=a.end_date
    and acceptedcmd.absence_kind=a.absence_kind and acceptedcmd.target_absence_id is null
    and acceptedcmd.accepted_revision=a.accepted_revision
    and acceptedcmd.prepared_by_manager_id=a.accepted_by_manager_id
    and acceptedcmd.confirmed_by_manager_id=a.accepted_by_manager_id
    and acceptedcmd.semantic_body=jsonb_build_object('absenceKind',a.absence_kind,'commandKind','absence',
     'employeeId',a.employee_id::text,'endDate',a.end_date::text,'startDate',a.start_date::text,'targetAbsenceId',null)
    and acceptedcmd.semantic_digest=public.static_weekly_digest_jsonb(acceptedcmd.semantic_body)
    and acceptedcmd.accepted_receipt->>'event'='ACCEPTED'
    and acceptedcmd.accepted_receipt->>'operation_id'=acceptedcmd.operation_id::text
    and acceptedcmd.accepted_receipt->>'semantic_digest'=acceptedcmd.semantic_digest
    and acceptedcmd.accepted_receipt->>'authority_revision'=a.accepted_revision::text where a.absence_id=command.target_absence_id
   and a.employee_id=command.employee_id and command.start_date=greatest(a.start_date,public.sch_service_date(statement_timestamp())) and command.start_date<=a.end_date
   and command.end_date=a.end_date
   and not exists(select 1 from public.static_weekly_staffing_absence_cancellations c where c.absence_id=a.absence_id)
 ) then raise exception using errcode='23514',message='staffing cancellation remaining window changed during preparation';end if;
 if jsonb_array_length(p_candidates)>100000 then raise exception using errcode='54000',message='staffing candidate row limit exceeded';end if;
 if exists(select 1 from jsonb_array_elements(p_candidates) item where jsonb_typeof(item)<>'object'
   or (select array_agg(key order by key) from jsonb_object_keys(item) key)
      is distinct from array['candidateKey','candidateKind','payload','serviceDate']::text[]
   or jsonb_typeof(item->'candidateKind') is distinct from 'string'
   or item->>'candidateKind' not in ('projection','lunch','schedule_refresh')
   or jsonb_typeof(item->'candidateKey') is distinct from 'string'
   or length(btrim(item->>'candidateKey')) not between 1 and 300
   or item->>'candidateKey' is distinct from btrim(item->>'candidateKey')
   or jsonb_typeof(item->'serviceDate') is distinct from 'string'
   or item->>'serviceDate'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   or jsonb_typeof(item->'payload') is distinct from 'object'
   or case when item->>'candidateKind' in ('projection','lunch')
      then not exists(select 1 from generate_series(command.start_date,command.end_date,'1 day') d where public.static_weekly_projection_window_start(d::date)=(item->>'serviceDate')::date)
      else (item->>'serviceDate')::date not between command.start_date and command.end_date end) then
  raise exception using errcode='22023',message='invalid staffing candidate row';end if;
 if p_candidates is distinct from (select coalesce(jsonb_agg(item order by (item->>'serviceDate') collate "C",
   (item->>'candidateKind') collate "C",(item->>'candidateKey') collate "C"),'[]'::jsonb) from jsonb_array_elements(p_candidates) item) then
  raise exception using errcode='22023',message='staffing candidates are not in deterministic order';end if;
 if exists(select 1 from jsonb_array_elements(p_candidates) item
  group by item->>'candidateKind',item->>'candidateKey' having count(*)<>1) then
  raise exception using errcode='23505',message='duplicate staffing candidate identity';end if;
 select count(distinct public.static_weekly_projection_window_start(d::date)) into v_week_count from generate_series(command.start_date,command.end_date,'1 day') d;
 select count(distinct (item->>'serviceDate')::date) filter(where item->>'candidateKind'='projection'),
  count(distinct (item->>'serviceDate')::date) filter(where item->>'candidateKind'='lunch') into v_projection_weeks,v_lunch_weeks from jsonb_array_elements(p_candidates) item;
 if v_projection_weeks is distinct from v_week_count or v_lunch_weeks is distinct from v_week_count
  or exists(select 1 from (select distinct public.static_weekly_projection_window_start(d::date) frame from generate_series(command.start_date,command.end_date,'1 day') d) frames
   where (select count(*) from jsonb_array_elements(p_candidates) item where item->>'candidateKind'='projection' and (item->>'serviceDate')::date=frame)<>1
    or (select count(*) from jsonb_array_elements(p_candidates) item where item->>'candidateKind'='lunch' and (item->>'serviceDate')::date=frame)<>1)
 then raise exception using errcode='23514',message='staffing exact source-aligned period companions are incomplete';end if;
 select count(*),coalesce(sum(octet_length(item::text)),0) into v_candidate_rows,v_candidate_bytes
  from jsonb_array_elements(p_candidates) item;
 if v_candidate_bytes>16777216 then raise exception using errcode='54000',message='staffing candidate byte limit exceeded';end if;
 v_summary:=jsonb_build_object('weeks',v_week_count,
  'projections',(select count(*) from jsonb_array_elements(p_candidates) item where item->>'candidateKind'='projection'),
  'lunches',(select count(*) from jsonb_array_elements(p_candidates) item where item->>'candidateKind'='lunch'),
  'scheduleRefreshes',(select count(*) from jsonb_array_elements(p_candidates) item where item->>'candidateKind'='schedule_refresh'));

 -- BEGIN PRIVATE ORIGINAL-PENDING APPROVED STAGE
 FOR v_pending IN SELECT item->'payload' payload,item->>'serviceDate' AS service_date_text FROM jsonb_array_elements(p_candidates) item
  WHERE item->>'candidateKind'='projection' AND item#>>'{payload,envelope,semantic_snapshot,schema}' IN('custodial.approved-static-pending-staffing-projection-snapshot.v1','custodial.approved-manual-pending-staffing-snapshot.v1') LOOP
  IF v_pending.payload->>'serviceDate' IS DISTINCT FROM v_pending.service_date_text
   OR p_publication_vector->'expectedRevision' IS DISTINCT FROM to_jsonb(command.expected_revision)
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_publication_vector->'weeks') w
    WHERE (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(w) k)=ARRAY['authorityRevision','publicationId','versionId','weekStart']::text[]
     AND w->>'weekStart'=v_pending.service_date_text AND w->'authorityRevision'=to_jsonb(command.expected_revision)
     AND w->'publicationId'=v_pending.payload->'publicationId'
     AND w->'versionId'=v_pending.payload#>'{envelope,semantic_snapshot,originalSource,version_id}')
  THEN RAISE EXCEPTION 'Pending original publication vector differs';END IF;
  PERFORM public.static_weekly_pending_assert_payload(p_operation_id,p_manager_id,v_pending.payload);
  SELECT item->'payload' INTO STRICT v_pending_lunch FROM jsonb_array_elements(p_candidates) item
   WHERE item->>'candidateKind'='lunch' AND item->>'serviceDate'=v_pending.service_date_text;
  PERFORM public.static_weekly_pending_assert_lunch(p_operation_id,p_manager_id,(v_pending.payload->>'publicationId')::uuid,
   v_pending.service_date_text::date,v_pending.payload->'envelope',v_pending_lunch);
 END LOOP;
 -- END PRIVATE ORIGINAL-PENDING APPROVED STAGE
 insert into public.static_weekly_staffing_staged_candidates(operation_id,candidate_kind,candidate_key,service_date,
  payload_json,payload_digest,canonical_bytes)
 select command.operation_id,item->>'candidateKind',item->>'candidateKey',(item->>'serviceDate')::date,item->'payload',
  public.static_weekly_digest_jsonb(item->'payload'),octet_length(item::text)
 from jsonb_array_elements(p_candidates) item;
 perform set_config('app.static_weekly_staffing_write','on',true);
 update public.static_weekly_staffing_commands set state='PREPARED',preview_digest=p_preview_digest,
  input_digest=p_input_digest,candidate_set_digest=v_candidate_set_digest,candidate_row_count=v_candidate_rows,
  candidate_bytes=v_candidate_bytes,publication_vector=p_publication_vector,candidate_summary=v_summary,
  prepared_at=statement_timestamp() where operation_id=command.operation_id;
 v_receipt:=jsonb_build_object('operation_id',command.operation_id,'event','PREPARED','manager_id',p_manager_id,
  'semantic_digest',command.semantic_digest,'candidate_set_digest',v_candidate_set_digest,
  'candidate_row_count',v_candidate_rows,'candidate_bytes',v_candidate_bytes,'recorded_at',statement_timestamp());
 insert into public.static_weekly_staffing_command_receipts(operation_id,event_kind,actor_manager_id,
  semantic_digest,receipt_json,receipt_digest) values(command.operation_id,'PREPARED',p_manager_id,
  command.semantic_digest,v_receipt,public.static_weekly_digest_jsonb(v_receipt));
 return jsonb_build_object('operation_id',command.operation_id,'state','PREPARED',
  'candidate_set_digest',v_candidate_set_digest,'candidate_row_count',v_candidate_rows,
  'candidate_bytes',v_candidate_bytes,'candidate_summary',v_summary,'replayed',false);
end $function$;
CREATE OR REPLACE FUNCTION public.static_weekly_v11_accept_staffing_command(p_operation_id uuid, p_preview_digest text, p_confirmation_key uuid, p_manager_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_pending_check jsonb; actor jsonb;command public.static_weekly_staffing_commands%rowtype;target_absence public.static_weekly_staffing_absences%rowtype;
 v_candidates jsonb;v_count integer;v_bytes bigint;v_current_revision bigint;v_revision bigint;
 v_content_digest text;v_projection_candidate record;v_lunch jsonb;v_payload jsonb;v_projection_response jsonb;
 v_projection uuid;v_existing public.weekly_schedule_compiled_projections%rowtype;v_existing_lunch public.weekly_schedule_lunch_documents%rowtype;
 v_signed_envelope jsonb;v_request jsonb;v_request_digest text;v_projection_content_digest text;v_projection_receipt jsonb;
 v_projection_map jsonb:='{}'::jsonb;v_refresh record;v_mapping jsonb;v_intent_count integer:=0;
 v_missing_device jsonb:='[]'::jsonb;v_prior_refresh jsonb:='[]'::jsonb;v_receipt jsonb;v_receipt_digest text;v_reused boolean;v_command_id uuid;
begin
 perform public.static_weekly_v3_assert_control_plane();actor:=public.static_weekly_v3_manager_actor(p_manager_id);
 perform public.custodial_begin_application_mutation();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into command from public.static_weekly_staffing_commands where operation_id=p_operation_id for update;
 if not found then raise exception using errcode='P0002',message='staffing command is unavailable';end if;
 if command.state='ACCEPTED' then
  if command.prepared_by_manager_id is distinct from p_manager_id
   or command.confirmation_key is distinct from p_confirmation_key
   or command.preview_digest is distinct from p_preview_digest then
   raise exception using errcode='23505',message='accepted staffing command was replayed with different confirmation identity';end if;
  return command.accepted_receipt||jsonb_build_object('replayed',true);
 end if;
 if command.state<>'PREPARED' then raise exception using errcode='55000',message='staffing command is not prepared for acceptance';end if;
 if command.prepared_by_manager_id is distinct from p_manager_id then
  raise exception using errcode='42501',message='only the authenticated original preparer may confirm this command';end if;
 if p_confirmation_key is null or p_preview_digest is null or p_preview_digest!~'^[0-9a-f]{64}$'
  or command.preview_digest is distinct from p_preview_digest then
  raise exception using errcode='22023',message='exact staffing preview and confirmation key are required';end if;
 if command.command_kind='cancel_absence' and command.start_date<public.sch_service_date(statement_timestamp()) then
  perform set_config('app.static_weekly_staffing_write','on',true);
  update public.static_weekly_staffing_commands set state='REJECTED' where operation_id=command.operation_id;
  v_receipt:=jsonb_build_object('operation_id',command.operation_id,'event','REJECTED',
   'reason','ELAPSED_CANCELLATION','manager_id',p_manager_id,'semantic_digest',command.semantic_digest,
   'preview_digest',command.preview_digest,'recorded_at',statement_timestamp());
  insert into public.static_weekly_staffing_command_receipts(operation_id,event_kind,actor_manager_id,
   semantic_digest,receipt_json,receipt_digest) values(command.operation_id,'REJECTED',p_manager_id,
   command.semantic_digest,v_receipt,public.static_weekly_digest_jsonb(v_receipt));
  return jsonb_build_object('operation_id',command.operation_id,'state','REJECTED',
   'reason','ELAPSED_CANCELLATION','replayed',false);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('candidateKey',candidate_key,'candidateKind',candidate_kind,
  'payload',payload_json,'serviceDate',service_date::text)
  order by service_date,candidate_kind collate "C",candidate_key collate "C"),'[]'::jsonb),
  count(*),coalesce(sum(canonical_bytes),0) into v_candidates,v_count,v_bytes
 from public.static_weekly_staffing_staged_candidates where operation_id=command.operation_id;
 if public.static_weekly_digest_jsonb(v_candidates) is distinct from command.candidate_set_digest
  or v_count is distinct from command.candidate_row_count or v_bytes is distinct from command.candidate_bytes
  or v_count>100000 or v_bytes>16777216 then
  raise exception using errcode='23514',message='prepared staffing candidate set no longer matches its complete digest';end if;
 select current_revision into v_current_revision from public.static_weekly_schedule_control where singleton for update;
 if v_current_revision is distinct from command.expected_revision then
  raise exception using errcode='40001',message='staffing confirmation expected revision is stale';end if;
 if command.command_kind='absence' and not exists(select 1 from public.employees where id=command.employee_id and active=true) then
  raise exception using errcode='23514',message='staffing command employee is no longer active';end if;
 if command.command_kind='cancel_absence' then
  select * into target_absence from public.static_weekly_staffing_absences a
  join public.static_weekly_staffing_commands acceptedcmd
   on acceptedcmd.operation_id=a.accepted_operation_id and acceptedcmd.operation_id=a.absence_id
    and acceptedcmd.command_kind='absence' and acceptedcmd.state='ACCEPTED'
    and acceptedcmd.employee_id=a.employee_id and acceptedcmd.start_date=a.start_date and acceptedcmd.end_date=a.end_date
    and acceptedcmd.absence_kind=a.absence_kind and acceptedcmd.target_absence_id is null
    and acceptedcmd.accepted_revision=a.accepted_revision
    and acceptedcmd.prepared_by_manager_id=a.accepted_by_manager_id
    and acceptedcmd.confirmed_by_manager_id=a.accepted_by_manager_id
    and acceptedcmd.semantic_body=jsonb_build_object('absenceKind',a.absence_kind,'commandKind','absence',
     'employeeId',a.employee_id::text,'endDate',a.end_date::text,'startDate',a.start_date::text,'targetAbsenceId',null)
    and acceptedcmd.semantic_digest=public.static_weekly_digest_jsonb(acceptedcmd.semantic_body)
    and acceptedcmd.accepted_receipt->>'event'='ACCEPTED'
    and acceptedcmd.accepted_receipt->>'operation_id'=acceptedcmd.operation_id::text
    and acceptedcmd.accepted_receipt->>'semantic_digest'=acceptedcmd.semantic_digest
    and acceptedcmd.accepted_receipt->>'authority_revision'=a.accepted_revision::text
   where a.absence_id=command.target_absence_id and a.employee_id=command.employee_id
    and command.start_date=greatest(a.start_date,public.sch_service_date(statement_timestamp())) and command.start_date<=a.end_date and command.end_date=a.end_date
    and not exists(select 1 from public.static_weekly_staffing_absence_cancellations c where c.absence_id=a.absence_id)
   for share;
  if not found then raise exception using errcode='23514',message='staffing cancellation must target the exact uncancelled remaining absence window';end if;
 end if;
 if jsonb_typeof(command.publication_vector) is distinct from 'object'
  or (select array_agg(key order by key) from jsonb_object_keys(command.publication_vector) key)
    is distinct from array['expectedRevision','weeks']::text[]
  or (command.publication_vector->>'expectedRevision')::bigint<>command.expected_revision
  or jsonb_typeof(command.publication_vector->'weeks') is distinct from 'array' then
  raise exception using errcode='23514',message='prepared staffing publication vector is invalid';end if;
 if exists(select 1 from jsonb_array_elements(command.publication_vector->'weeks') week
  where jsonb_typeof(week)<>'object'
   or (select array_agg(key order by key) from jsonb_object_keys(week) key)
      is distinct from array['authorityRevision','publicationId','versionId','weekStart']::text[]
   or (week->>'authorityRevision')::bigint<>command.expected_revision
   or not exists(select 1 from public.weekly_schedule_publications p
    where p.publication_id=(week->>'publicationId')::uuid and p.version_id=(week->>'versionId')::uuid
     and public.static_weekly_effective_version((week->>'weekStart')::date)=p.version_id)) then
  raise exception using errcode='23514',message='prepared staffing publication vector became stale';end if;
 if (select count(*) from jsonb_array_elements(command.publication_vector->'weeks'))<>
    (select count(*) from public.static_weekly_staffing_staged_candidates
      where operation_id=command.operation_id and candidate_kind='projection') then
  raise exception using errcode='23514',message='prepared staffing projection vector is incomplete';end if;

 v_prior_refresh:=public.static_weekly_v11_read_current_refresh_targets(
  command.start_date,command.end_date,p_manager_id);

 v_content_digest:=public.static_weekly_digest_jsonb(jsonb_build_object('operation_id',command.operation_id,
  'semantic_digest',command.semantic_digest,'preview_digest',command.preview_digest,
  'input_digest',command.input_digest,'candidate_set_digest',command.candidate_set_digest,
  'publication_vector',command.publication_vector));
 v_revision:=public.static_weekly_advance_authority(command.expected_revision,'apply_staffing_command',
  p_manager_id,actor->>'manager_name',command.operation_id,v_content_digest);
 if command.command_kind='absence' then
  insert into public.static_weekly_staffing_absences(absence_id,employee_id,absence_kind,start_date,end_date,
   accepted_operation_id,accepted_revision,accepted_by_manager_id)
  values(command.operation_id,command.employee_id,command.absence_kind,command.start_date,command.end_date,
   command.operation_id,v_revision,p_manager_id);
 else
  insert into public.static_weekly_staffing_absence_cancellations(absence_id,accepted_operation_id,
   remaining_start_date,remaining_end_date,accepted_revision,accepted_by_manager_id)
  values(command.target_absence_id,command.operation_id,command.start_date,command.end_date,v_revision,p_manager_id);
 end if;
 perform set_config('app.static_weekly_staffing_batch_operation',command.operation_id::text,true);

 for v_projection_candidate in select service_date,payload_json from public.static_weekly_staffing_staged_candidates
  where operation_id=command.operation_id and candidate_kind='projection' order by service_date,candidate_key loop
  v_payload:=v_projection_candidate.payload_json;
  if (select array_agg(key order by key) from jsonb_object_keys(v_payload) key) is distinct from
   array['actorManagerId','actorManagerName','compilerVersion','envelope','exceptionSetDigest','expectedRevision',
    'idempotencyKey','metrics','objective','publicationId','replayDigest','serviceDate']::text[]
   or (v_payload->>'serviceDate')::date is distinct from v_projection_candidate.service_date
   or (v_payload->>'expectedRevision')::bigint is distinct from command.expected_revision
   or v_payload->>'actorManagerId' is distinct from p_manager_id::text
   or v_payload->>'idempotencyKey' is distinct from 'staffing:'||command.operation_id::text||':'||v_projection_candidate.service_date::text
   or not exists(select 1 from jsonb_array_elements(command.publication_vector->'weeks') week
    where week->>'weekStart'=v_projection_candidate.service_date::text
     and week->>'publicationId'=v_payload->>'publicationId'
     and week->>'versionId'=v_payload#>>'{envelope,authority,compilerInput,version,id}') then
   raise exception using errcode='23514',message='staged staffing projection identity is invalid';end if;
  if v_payload->>'exceptionSetDigest' is distinct from public.static_weekly_digest_jsonb(
    public.static_weekly_accepted_exception_set((v_payload->>'publicationId')::uuid,v_projection_candidate.service_date))
   or v_payload->>'compilerVersion' is distinct from v_payload#>>'{envelope,compiler_version}'
   or v_payload->'objective' is distinct from v_payload#>'{envelope,objective}'
   or v_payload->'metrics' is distinct from v_payload#>'{envelope,metrics}'
   or v_payload->>'replayDigest' is distinct from v_payload#>>'{envelope,replay_digest}' then
   raise exception using errcode='23514',message='staged staffing projection compiler identity no longer matches accepted exception authority',
    detail=jsonb_build_object('staged_exception_digest',v_payload->>'exceptionSetDigest',
     'database_exception_digest',public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(
      (v_payload->>'publicationId')::uuid,v_projection_candidate.service_date)),
     'staged_exceptions',v_payload#>'{envelope,applied_exceptions}',
     'database_exceptions',public.static_weekly_accepted_exception_set(
      (v_payload->>'publicationId')::uuid,v_projection_candidate.service_date))::text;end if;

  -- BEGIN PRIVATE ORIGINAL-PENDING APPROVED ACCEPT
  IF v_payload#>>'{envelope,semantic_snapshot,schema}' IN('custodial.approved-static-pending-staffing-projection-snapshot.v1','custodial.approved-manual-pending-staffing-snapshot.v1') THEN
   v_pending_check:=public.static_weekly_pending_assert_payload(command.operation_id,p_manager_id,v_payload);
   IF (v_pending_check->>'afterFact')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Pending original fact not accepted in this transaction';END IF;
   v_projection_response:=public.static_weekly_pending_projection_sink((v_payload->>'publicationId')::uuid,
    v_projection_candidate.service_date,v_payload->>'exceptionSetDigest',v_payload->>'compilerVersion',v_payload->'objective',
    v_payload->'metrics',v_payload->>'replayDigest',v_payload->'envelope',command.expected_revision,p_manager_id,
    actor->>'manager_name',v_payload->>'idempotencyKey');
   v_projection:=(v_projection_response#>>'{data,projection_id}')::uuid;
  ELSE
  v_signed_envelope:=jsonb_set(v_payload->'envelope','{attestation}',
   public.static_weekly_v3_issue_attestation('dated_projection',
    public.static_weekly_projection_attestation_payload(v_payload->'envelope')),true);
  select * into v_existing from public.weekly_schedule_compiled_projections p
   where p.publication_id=(v_payload->>'publicationId')::uuid
    and p.week_start=v_projection_candidate.service_date
    and p.exception_set_digest=public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(
     (v_payload->>'publicationId')::uuid,v_projection_candidate.service_date))
    and p.compiler_version=v_payload->>'compilerVersion'
    and p.authority_digest=v_signed_envelope->>'authority_digest'
   order by p.compiled_at desc,p.projection_id desc limit 1;
  v_reused:=found;
  if v_reused then
   if (v_existing.projection_envelope-array['attestation','receipt','database_projection_identity']) is distinct from
      (v_signed_envelope-array['attestation','receipt','database_projection_identity']) then
    raise exception using errcode='23514',message='historical projection identity conflicts with the exact staged candidate';end if;
   v_projection:=v_existing.projection_id;
   v_command_id:=gen_random_uuid();
   v_request:=jsonb_build_object('operation','materialize_projection','publication_id',(v_payload->>'publicationId')::uuid,
    'service_date',v_projection_candidate.service_date,'exception_set_digest',v_existing.exception_set_digest,
    'compiler_version',v_existing.compiler_version,'objective',v_existing.objective_json,'metrics',v_existing.metrics_json,
    'replay_digest',v_existing.replay_digest,'projection_envelope',v_existing.projection_envelope,
    'expected_revision',command.expected_revision,'actor_manager_id',p_manager_id,'actor_manager_name',actor->>'manager_name');
   v_request_digest:=public.static_weekly_digest_jsonb(v_request);
   v_projection_content_digest:=public.static_weekly_digest_jsonb(jsonb_build_object(
    'publication_id',v_existing.publication_id,'week_start',v_existing.week_start,
    'exception_set_digest',v_existing.exception_set_digest,'compiler_version',v_existing.compiler_version,
    'objective',v_existing.objective_json,'metrics',v_existing.metrics_json,'replay_digest',v_existing.replay_digest,
    'projection_envelope_identity',v_existing.projection_envelope->>'database_projection_identity',
    'attestation',v_existing.projection_envelope->'attestation'));
   v_projection_receipt:=public.static_weekly_response_json('materialize_projection',v_revision,
    v_projection_content_digest,v_request_digest,jsonb_build_object('projection_id',v_projection,
     'publication_id',v_existing.publication_id,'week_start',v_existing.week_start,
     'week_end',v_existing.week_end,'replay_digest',v_existing.replay_digest));
   insert into public.weekly_schedule_command_receipts(command_id,actor_manager_id,actor_manager_name_snapshot,
    command_type,idempotency_key,expected_revision,request_digest,request_canonical_json,response_json,response_digest,content_digest)
   values(v_command_id,p_manager_id,actor->>'manager_name','materialize_projection',v_payload->>'idempotencyKey',
    command.expected_revision,v_request_digest,v_request,v_projection_receipt,v_projection_receipt->>'output_digest',v_projection_content_digest);
  else
   v_projection_response:=public.static_weekly_v3_materialize_projection(
    (v_payload->>'publicationId')::uuid,v_projection_candidate.service_date,v_payload->>'exceptionSetDigest',
    v_payload->>'compilerVersion',v_payload->'objective',v_payload->'metrics',v_payload->>'replayDigest',
    v_payload->'envelope',command.expected_revision,p_manager_id,v_payload->>'idempotencyKey');
   v_projection:=(v_projection_response#>>'{data,projection_id}')::uuid;
  end if;

  END IF;
  -- END PRIVATE ORIGINAL-PENDING APPROVED ACCEPT
  select payload_json into strict v_lunch from public.static_weekly_staffing_staged_candidates
   where operation_id=command.operation_id and candidate_kind='lunch'
    and service_date=v_projection_candidate.service_date;

  IF v_payload#>>'{envelope,semantic_snapshot,schema}' IN('custodial.approved-static-pending-staffing-projection-snapshot.v1','custodial.approved-manual-pending-staffing-snapshot.v1') THEN
   PERFORM public.static_weekly_pending_assert_lunch(command.operation_id,p_manager_id,(v_payload->>'publicationId')::uuid,
    v_projection_candidate.service_date,v_payload->'envelope',v_lunch);
   IF NOT EXISTS(SELECT 1 FROM public.weekly_schedule_compiled_projections WHERE projection_id=v_projection
    AND projection_envelope=v_payload->'envelope' AND compiled_by_manager_id=p_manager_id) THEN RAISE EXCEPTION 'Pending exact persisted original projection differs';END IF;
  END IF;
  perform public.static_weekly_v8_materialize_lunch_document(v_projection,v_lunch,p_manager_id);
  select * into strict v_existing_lunch from public.weekly_schedule_lunch_documents where projection_id=v_projection;
  v_projection_map:=v_projection_map||jsonb_build_object(v_projection_candidate.service_date::text,
   jsonb_build_object('projection_id',v_projection,'publication_id',(v_payload->>'publicationId')::uuid,
    'projection_identity',v_payload#>>'{envelope,database_projection_identity}',
    'lunch_document_identity',v_existing_lunch.document_identity,'reused',v_reused));
 end loop;

 if exists(
 with projection as (select service_date week_start,payload_json from public.static_weekly_staffing_staged_candidates
    where operation_id=command.operation_id and candidate_kind='projection'),
  lunch as (select payload_json from public.static_weekly_staffing_staged_candidates
    where operation_id=command.operation_id and candidate_kind='lunch'),
  expected as (
   select distinct assignment->>'service_date' service_date,assignment->>'owner_person_id' employee_id
   from projection cross join lateral jsonb_array_elements(payload_json#>'{envelope,assignments}') assignment
   where lower(assignment->>'status')='assigned' and assignment->>'owner_person_id' is not null
    and assignment->>'service_date' between command.start_date::text and command.end_date::text
   union select responsibility->>'service_date',responsibility->>'normal_owner_person_id'
    from lunch cross join lateral jsonb_array_elements(coalesce(payload_json->'responsibilities','[]'::jsonb)) responsibility
    where responsibility->>'service_date' between command.start_date::text and command.end_date::text
     and responsibility->>'normal_owner_person_id' is not null
   union select responsibility->>'service_date',responsibility->>'coverer_person_id'
    from lunch cross join lateral jsonb_array_elements(coalesce(payload_json->'responsibilities','[]'::jsonb)) responsibility
    where responsibility->>'service_date' between command.start_date::text and command.end_date::text
     and responsibility->>'coverer_person_id' is not null
   union select item->>'serviceDate',item->>'employeeId' from jsonb_array_elements(v_prior_refresh) item
   union select (day::date)::text,command.employee_id::text from generate_series(command.start_date,command.end_date,interval '1 day') day
    where command.command_kind='absence'
  ),actual as (select service_date::text,payload_json->>'employeeId' employee_id
   from public.static_weekly_staffing_staged_candidates where operation_id=command.operation_id and candidate_kind='schedule_refresh')
  (select * from expected except select * from actual) union all (select * from actual except select * from expected)
 ) then raise exception using errcode='23514',message='affected employee schedule refresh set is incomplete or excessive';end if;

 for v_refresh in select service_date,payload_json from public.static_weekly_staffing_staged_candidates
  where operation_id=command.operation_id and candidate_kind='schedule_refresh' order by service_date,candidate_key loop
  v_mapping:=v_projection_map->(v_refresh.payload_json->>'weekStart');
  if (select array_agg(key order by key) from jsonb_object_keys(v_refresh.payload_json) key) is distinct from
   array['employeeId','lunchDocumentIdentity','projectionIdentity','publicationId','weekStart']::text[]
   or v_mapping is null or v_refresh.payload_json->>'publicationId' is distinct from v_mapping->>'publication_id'
   or v_refresh.payload_json->>'projectionIdentity' is distinct from v_mapping->>'projection_identity'
   or v_refresh.payload_json->>'lunchDocumentIdentity' is distinct from v_mapping->>'lunch_document_identity'
   or v_refresh.service_date not between command.start_date and command.end_date then
   raise exception using errcode='23514',message='schedule refresh is not bound to the exact accepted projection and lunch';end if;
  insert into public.static_weekly_schedule_application_intents(operation_id,service_date,employee_id,
   device_id,credential_id,assignment_epoch,authority_revision,publication_id,projection_id,lunch_document_identity)
  select command.operation_id,v_refresh.service_date,(v_refresh.payload_json->>'employeeId')::uuid,
   d.id,c.credential_id,d.assignment_epoch,v_revision,(v_mapping->>'publication_id')::uuid,
   (v_mapping->>'projection_id')::uuid,v_mapping->>'lunch_document_identity'
  from public.devices d join public.device_auth_credentials c on c.device_id=d.id
   and c.confirmed_at is not null and c.revoked_at is null and c.expires_at>statement_timestamp()
  where d.active=true and d.assigned_employee_id=(v_refresh.payload_json->>'employeeId')::uuid;
  get diagnostics v_count=row_count;v_intent_count:=v_intent_count+v_count;
  if v_count=0 then v_missing_device:=v_missing_device||jsonb_build_array(jsonb_build_object(
   'service_date',v_refresh.service_date,'employee_id',v_refresh.payload_json->>'employeeId','status','NO_CURRENT_DEVICE'));end if;
 end loop;

 v_receipt:=jsonb_build_object('operation_id',command.operation_id,'event','ACCEPTED',
  'manager_id',p_manager_id,'original_preparer_manager_id',command.prepared_by_manager_id,
  'semantic_digest',command.semantic_digest,'preview_digest',command.preview_digest,
  'candidate_set_digest',command.candidate_set_digest,'authority_revision',v_revision,
  'projections',v_projection_map,'device_intent_count',v_intent_count,
  'missing_device_targets',v_missing_device,'recorded_at',statement_timestamp());
 v_receipt_digest:=public.static_weekly_digest_jsonb(v_receipt);
 perform set_config('app.static_weekly_staffing_write','on',true);
 update public.static_weekly_staffing_commands set state='ACCEPTED',confirmation_key=p_confirmation_key,
  confirmed_by_manager_id=p_manager_id,authority_command_id=command.operation_id,accepted_revision=v_revision,
  accepted_receipt=v_receipt,accepted_at=statement_timestamp() where operation_id=command.operation_id;
 insert into public.static_weekly_staffing_command_receipts(operation_id,event_kind,actor_manager_id,
  semantic_digest,receipt_json,receipt_digest) values(command.operation_id,'ACCEPTED',p_manager_id,
  command.semantic_digest,v_receipt,v_receipt_digest);
 return v_receipt||jsonb_build_object('replayed',false);
end $function$;
CREATE OR REPLACE FUNCTION public.static_weekly_v11_staged_projection_digest_matches(p_operation_id uuid, p_content_digest text, p_manager_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare candidate record;signed_envelope jsonb;expected_digest text;matches integer:=0;
begin
 for candidate in select payload_json from public.static_weekly_staffing_staged_candidates
  where operation_id=p_operation_id and candidate_kind='projection' loop
  if candidate.payload_json->>'actorManagerId' is distinct from p_manager_id::text then continue;end if;

  -- BEGIN PRIVATE ORIGINAL-PENDING BATCH DIGEST
  IF candidate.payload_json#>>'{envelope,semantic_snapshot,schema}' IN('custodial.approved-static-pending-staffing-projection-snapshot.v1','custodial.approved-manual-pending-staffing-snapshot.v1') THEN
   PERFORM public.static_weekly_pending_assert_payload(p_operation_id,p_manager_id,candidate.payload_json);
   expected_digest:=public.static_weekly_digest_jsonb(jsonb_build_object(
    'publication_id',(candidate.payload_json->>'publicationId')::uuid,'week_start',(candidate.payload_json->>'serviceDate')::date,
    'exception_set_digest',candidate.payload_json->>'exceptionSetDigest','compiler_version',candidate.payload_json->>'compilerVersion',
    'objective',candidate.payload_json->'objective','metrics',candidate.payload_json->'metrics','replay_digest',candidate.payload_json->>'replayDigest',
    'projection_envelope_identity',candidate.payload_json#>>'{envelope,database_projection_identity}','attestation',NULL));
   IF expected_digest=p_content_digest THEN matches:=matches+1;END IF;
   CONTINUE;
  END IF;
  -- END PRIVATE ORIGINAL-PENDING BATCH DIGEST
  signed_envelope:=jsonb_set(candidate.payload_json->'envelope','{attestation}',
   public.static_weekly_v3_issue_attestation('dated_projection',
    public.static_weekly_projection_attestation_payload(candidate.payload_json->'envelope')),true);
  expected_digest:=public.static_weekly_digest_jsonb(jsonb_build_object(
   'publication_id',(candidate.payload_json->>'publicationId')::uuid,
   'week_start',(candidate.payload_json->>'serviceDate')::date,
   'exception_set_digest',public.static_weekly_digest_jsonb(public.static_weekly_accepted_exception_set(
    (candidate.payload_json->>'publicationId')::uuid,(candidate.payload_json->>'serviceDate')::date)),
   'compiler_version',candidate.payload_json->>'compilerVersion','objective',candidate.payload_json->'objective',
   'metrics',candidate.payload_json->'metrics','replay_digest',candidate.payload_json->>'replayDigest',
   'projection_envelope_identity',signed_envelope->>'database_projection_identity',
   'attestation',signed_envelope->'attestation'));
  if expected_digest=p_content_digest then matches:=matches+1;end if;
 end loop;
 return matches=1;
exception when others then return false;
end $function$;
CREATE OR REPLACE FUNCTION public.static_weekly_v10_read_staffing_command(p_operation_id uuid, p_manager_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare command public.static_weekly_staffing_commands%rowtype;
 original_target jsonb:=null;target_revision bigint;
 preview_weeks jsonb:='[]'::jsonb; prepared_week jsonb; projection record;
 envelope jsonb; availability jsonb; safe_availability jsonb; a jsonb;
 safe_row jsonb; field text; value jsonb; windows jsonb; w jsonb;
 safe_objective jsonb; safe_metrics jsonb; daily jsonb; day_row jsonb;
 loads jsonb; load_row jsonb; safe_load jsonb; safe_day jsonb; weekly jsonb;
 map_value jsonb; pair record; raw_metrics jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();perform public.static_weekly_v3_manager_actor(p_manager_id);
 select * into command from public.static_weekly_staffing_commands where operation_id=p_operation_id;
 if not found then return null; end if;
 -- Cancellation refers to an immutable original absence, not today's incumbent.
 -- Only the authenticated current pending command may expose this private target.
 if command.command_kind='cancel_absence' and command.state in ('PREPARING','PREPARED') then
  if command.prepared_by_manager_id is distinct from p_manager_id then
   raise exception using errcode='42501',message='only original authenticated preparer may read cancellation target';end if;
  select control.current_revision into strict target_revision from public.static_weekly_schedule_control control where control.singleton;
  if command.expected_revision is distinct from target_revision then
   raise exception using errcode='40001',message='original cancellation target revision is stale';end if;
  if command.semantic_digest is distinct from public.static_weekly_digest_jsonb(command.semantic_body)
   or command.semantic_body is distinct from jsonb_build_object('absenceKind',null,'commandKind','cancel_absence',
    'employeeId',command.employee_id::text,'endDate',command.end_date::text,'startDate',command.start_date::text,
    'targetAbsenceId',command.target_absence_id::text) then
   raise exception using errcode='23514',message='original cancellation command identity is inconsistent';end if;
  select jsonb_build_object('absenceId',a.absence_id::text,'employeeId',a.employee_id::text,
   'startDate',a.start_date::text,'endDate',a.end_date::text,'acceptedOperationId',a.accepted_operation_id::text,
   'status','accepted') into original_target
  from public.static_weekly_staffing_absences a
  join public.static_weekly_staffing_commands acceptedcmd
   on acceptedcmd.operation_id=a.accepted_operation_id and acceptedcmd.operation_id=a.absence_id
    and acceptedcmd.command_kind='absence' and acceptedcmd.state='ACCEPTED'
    and acceptedcmd.employee_id=a.employee_id and acceptedcmd.start_date=a.start_date and acceptedcmd.end_date=a.end_date
    and acceptedcmd.absence_kind=a.absence_kind and acceptedcmd.target_absence_id is null
    and acceptedcmd.accepted_revision=a.accepted_revision
    and acceptedcmd.prepared_by_manager_id=a.accepted_by_manager_id
    and acceptedcmd.confirmed_by_manager_id=a.accepted_by_manager_id
    and acceptedcmd.semantic_body=jsonb_build_object('absenceKind',a.absence_kind,'commandKind','absence',
     'employeeId',a.employee_id::text,'endDate',a.end_date::text,'startDate',a.start_date::text,'targetAbsenceId',null)
    and acceptedcmd.semantic_digest=public.static_weekly_digest_jsonb(acceptedcmd.semantic_body)
    and acceptedcmd.accepted_receipt->>'event'='ACCEPTED'
    and acceptedcmd.accepted_receipt->>'operation_id'=acceptedcmd.operation_id::text
    and acceptedcmd.accepted_receipt->>'semantic_digest'=acceptedcmd.semantic_digest
    and acceptedcmd.accepted_receipt->>'authority_revision'=a.accepted_revision::text
  where a.absence_id=command.target_absence_id and a.employee_id=command.employee_id
   and command.start_date=greatest(a.start_date,public.sch_service_date(statement_timestamp()))
   and command.start_date<=a.end_date and command.end_date=a.end_date
   and not exists(select 1 from public.static_weekly_staffing_absence_cancellations c where c.absence_id=a.absence_id);
  if not found then raise exception using errcode='23514',message='original accepted cancellation target is unavailable or inconsistent';end if;
 end if;
 -- Only this command's immutable PREPARED candidates may supply these facts.
 -- PREPARING/terminal states retain the original null preview behavior.
 if command.state='PREPARED' then
  if (select count(*) from public.static_weekly_staffing_staged_candidates
   where operation_id=command.operation_id and candidate_kind='projection')>54 then
   raise exception using errcode='54000',message='prepared preview week bound exceeded';end if;
  for projection in
   select p.*,l.payload_json as lunch_payload
   from public.static_weekly_staffing_staged_candidates p
   left join public.static_weekly_staffing_staged_candidates l
    on l.operation_id=p.operation_id and l.candidate_kind='lunch' and l.service_date=p.service_date
   where p.operation_id=command.operation_id and p.candidate_kind='projection'
   order by p.service_date
  loop
   if projection.payload_digest is distinct from public.static_weekly_digest_jsonb(projection.payload_json) then
    raise exception using errcode='23514',message='prepared preview staged projection digest changed';end if;
   envelope:=projection.payload_json->'envelope';
   availability:=envelope#>'{authority,projectionAvailability}';
   safe_availability:=null;
   if jsonb_typeof(availability)='array' then
    if jsonb_array_length(availability)>1792 then
     raise exception using errcode='54000',message='prepared preview availability bound exceeded';end if;
    safe_availability:='[]'::jsonb;
    for a in select item from jsonb_array_elements(availability) item loop
     if jsonb_typeof(a) is distinct from 'object' then
      raise exception using errcode='23514',message='prepared preview availability row is not an object';end if;
     safe_row:='{}'::jsonb;
     foreach field in array array['serviceDate','slotId','status','incumbentSlotId','incumbentSlotLabel',
      'incumbentPersonId','incumbentName','ownerKind','capacityId','acceptedRouteAnchorLocationId',
      'acceptedRouteStartLocationId','routeAnchorLocationId'] loop
      value:=a->field;
      safe_row:=safe_row||jsonb_build_object(field,case when jsonb_typeof(value)='string'
       and length(a->>field)<=300 then value else null end);
     end loop;
     foreach field in array array['dayOfWeek','productiveCapacityMinutes','maxServiceEffortMinutes',
      'maxLoadPoints','maxDutyMinutes'] loop
      value:=a->field;
      safe_row:=safe_row||jsonb_build_object(field,case when jsonb_typeof(value)='number' then value else null end);
     end loop;
     foreach field in array array['shift','lunch'] loop
      value:=a->field;
      safe_row:=safe_row||jsonb_build_object(field,case when jsonb_typeof(value)='object'
       then jsonb_build_object('start',case when jsonb_typeof(value->'start')='string' and length(value->>'start')<=5 then value->'start' else null end,
        'end',case when jsonb_typeof(value->'end')='string' and length(value->>'end')<=5 then value->'end' else null end) else null end);
     end loop;
     foreach field in array array['blockedWindows','productiveWindows'] loop
      value:=a->field;windows:=null;
      if jsonb_typeof(value)='array' then
       if jsonb_array_length(value)>256 then raise exception using errcode='54000',message='prepared preview window bound exceeded';end if;
       windows:='[]'::jsonb;
       for w in select item from jsonb_array_elements(value) item loop
        if jsonb_typeof(w) is distinct from 'object' then raise exception using errcode='23514',message='prepared preview window is not an object';end if;
        windows:=windows||jsonb_build_array(jsonb_build_object(
         'start',case when jsonb_typeof(w->'start')='string' and length(w->>'start')<=5 then w->'start' else null end,
         'end',case when jsonb_typeof(w->'end')='string' and length(w->>'end')<=5 then w->'end' else null end));
       end loop;
      end if;
      safe_row:=safe_row||jsonb_build_object(field,windows);
     end loop;
     -- Hash arbitrary provenance instead of leaking leave/restriction notes.
     foreach field in array array['productiveCapacityProvenance','capacityProvenance','acceptedRouteProvenance'] loop
      safe_row:=safe_row||jsonb_build_object(field||'Digest',case when a ? field and a->field<>'null'::jsonb
       then public.static_weekly_digest_jsonb(a->field) else null end);
     end loop;
     safe_row:=safe_row||jsonb_build_object('acceptedRoute',case when jsonb_typeof(a->'acceptedRoute')='object'
      then jsonb_build_object('startLocationId',case when jsonb_typeof(a#>'{acceptedRoute,startLocationId}')='string'
       and length(a#>>'{acceptedRoute,startLocationId}')<=300 then a#>'{acceptedRoute,startLocationId}' else null end) else null end);
     safe_row:=safe_row||jsonb_build_object('acceptedRouteDigest',case when jsonb_typeof(a->'acceptedRoute')='object'
      then public.static_weekly_digest_jsonb(a->'acceptedRoute') else null end);
     safe_availability:=safe_availability||jsonb_build_array(safe_row);
    end loop;
   end if;
   -- Safe fields only: never return optimizer certificates, witnesses, raw
   -- compiler slots/exceptions/proximity matrices or preflight source data.
   safe_objective:=null;
   if jsonb_typeof(envelope->'objective')='object' then
    safe_objective:='{}'::jsonb;
    foreach field in array array['mode','policyVersion','integerServiceEffort','serviceEffortWireSemantics',
     'directedTravelDuty','flexibleCoverageTravelRole','acceptedRouteInsertions','weeklyEquityResource',
     'equityIntegerScale','exactEquityCommonDenominator'] loop
     value:=envelope->'objective'->field;
     if jsonb_typeof(value) in ('number','boolean') or (jsonb_typeof(value)='string'
      and length(envelope->'objective'->>field)<=2000) then safe_objective:=safe_objective||jsonb_build_object(field,value);end if;
    end loop;
    foreach field in array array['tiers','rankingOrder'] loop
     value:=envelope->'objective'->field;
     if jsonb_typeof(value)='array' then
      if jsonb_array_length(value)>4096 or exists(select 1 from jsonb_array_elements(value) x
       where jsonb_typeof(x)<>'string' or length(x#>>'{}')>300) then
       raise exception using errcode='54000',message='prepared preview objective text bound exceeded';end if;
      safe_objective:=safe_objective||jsonb_build_object(field,value);
     end if;
    end loop;
   end if;
   raw_metrics:=envelope->'metrics';safe_metrics:=null;
   if jsonb_typeof(raw_metrics)='object' then
    safe_metrics:='{}'::jsonb;map_value:='{}'::jsonb;
    foreach field in array array['workload','service','travel','waiting','protected','totalDuty'] loop
     value:=raw_metrics->'dutySemantics'->field;
     if jsonb_typeof(value)='string' and length(raw_metrics->'dutySemantics'->>field)<=2000 then
      map_value:=map_value||jsonb_build_object(field,value);end if;
    end loop;
    safe_metrics:=safe_metrics||jsonb_build_object('dutySemantics',case when jsonb_typeof(raw_metrics->'dutySemantics')='object' then map_value else null end);
    daily:=null;
    if jsonb_typeof(raw_metrics->'daily')='array' then
     if jsonb_array_length(raw_metrics->'daily')>7 then raise exception using errcode='54000',message='prepared preview metric day bound exceeded';end if;
     daily:='[]'::jsonb;
     for day_row in select item from jsonb_array_elements(raw_metrics->'daily') item loop
      safe_day:='{}'::jsonb;
      foreach field in array array['dayOfWeek','normalizedInequity','exactNormalizedInequity'] loop
       value:=day_row->field;
       safe_day:=safe_day||jsonb_build_object(field,case when jsonb_typeof(value)='number' then value else null end);
      end loop;
      loads:=null;
      if jsonb_typeof(day_row->'loads')='array' then
       if jsonb_array_length(day_row->'loads')>256 then raise exception using errcode='54000',message='prepared preview metric slot bound exceeded';end if;
       loads:='[]'::jsonb;
       for load_row in select item from jsonb_array_elements(day_row->'loads') item loop
        safe_load:=jsonb_build_object('slotId',case when jsonb_typeof(load_row->'slotId')='string'
         and length(load_row->>'slotId')<=300 then load_row->'slotId' else null end);
        foreach field in array array['effort','capacity','utilization','normalizedLoad','serviceDutyMinutes',
         'serviceEffortMinutes','normalizedServiceLoad','maxServiceEffortMinutes',
         'fixedServiceEffortMinutes','flexibleWorkloadPoints','fixedRouteTravelMinutes','flexibleCoverageTravelMinutes',
         'travelDutyMinutes','waitingMinutes','fixedWindowWaitingMinutes','transitWaitingMinutes',
         'protectedBreakUnavailableMinutes','routeSpanMinutes','routeNodeCount','fixedRouteDutyMinutes',
         'totalDutyMinutes','dutyCapacityMinutes','productiveCapacityMinutes','acceptedRouteTravelMinutes'] loop
         value:=load_row->field;
         if jsonb_typeof(value)='number' then safe_load:=safe_load||jsonb_build_object(field,value);end if;
        end loop;
        loads:=loads||jsonb_build_array(safe_load);
       end loop;
      end if;
      daily:=daily||jsonb_build_array(safe_day||jsonb_build_object('loads',loads));
     end loop;
    end if;
    safe_metrics:=safe_metrics||jsonb_build_object('daily',daily);
    weekly:=null;
    if jsonb_typeof(raw_metrics->'weekly')='object' then
     weekly:='{}'::jsonb;
     foreach field in array array['normalizedInequity','incrementalDirectedRouteCost','disruption'] loop
      value:=raw_metrics->'weekly'->field;
      if jsonb_typeof(value)='number' then weekly:=weekly||jsonb_build_object(field,value);end if;
     end loop;
     value:=raw_metrics#>'{weekly,resource}';
     if jsonb_typeof(value)='string' and length(raw_metrics#>>'{weekly,resource}')<=2000 then weekly:=weekly||jsonb_build_object('resource',value);end if;
     foreach field in array array['normalizedLoads','provenancedWorkloadUnits','productiveCapacityMinutes','uncoveredByPriority'] loop
      value:=raw_metrics->'weekly'->field;
      if jsonb_typeof(value)='object' then
       if (select count(*) from jsonb_object_keys(value))>256 then raise exception using errcode='54000',message='prepared preview weekly metric bound exceeded';end if;
       map_value:='{}'::jsonb;
       for pair in select * from jsonb_each(value) loop
        if length(pair.key)<=300 and jsonb_typeof(pair.value)='number' then map_value:=map_value||jsonb_build_object(pair.key,pair.value);end if;
       end loop;
       weekly:=weekly||jsonb_build_object(field,map_value);
      end if;
     end loop;
    end if;
    safe_metrics:=safe_metrics||jsonb_build_object('weekly',weekly);
   end if;
   prepared_week:=jsonb_build_object(
    'week_start',projection.service_date::text,
    'assignments',coalesce(projection.payload_json#>'{envelope,assignments}','[]'::jsonb),
    'lunch_responsibilities',coalesce(projection.lunch_payload->'responsibilities','[]'::jsonb),
    'lunch_loans',coalesce(projection.lunch_payload->'loans','[]'::jsonb),
    'publicationId',case when jsonb_typeof(projection.payload_json->'publicationId')='string'
     and length(projection.payload_json->>'publicationId')<=300 then projection.payload_json->'publicationId' else null end,
    'versionId',case when jsonb_typeof(envelope#>'{authority,compilerInput,version,id}')='string'
     and length(envelope#>>'{authority,compilerInput,version,id}')<=300 then envelope#>'{authority,compilerInput,version,id}' else null end,
    'database_projection_identity',case when jsonb_typeof(envelope->'database_projection_identity')='string'
     and envelope->>'database_projection_identity'~'^[a-f0-9]{64}$' then envelope->'database_projection_identity' else null end,
    'replayDigest',case when jsonb_typeof(envelope->'replay_digest')='string'
     and envelope->>'replay_digest'~'^[a-f0-9]{64}$' then envelope->'replay_digest' else null end,
    'compilerVersion',case when jsonb_typeof(envelope->'compiler_version')='string'
     and length(envelope->>'compiler_version')<=300 then envelope->'compiler_version' else null end,
    'objective',safe_objective,'metrics',safe_metrics,'projectionAvailability',safe_availability,
    'projectionAvailabilityDigest',case when jsonb_typeof(availability)='array' then public.static_weekly_digest_jsonb(availability) else null end,
    'projectionAvailabilityBasis','envelope.authority.projectionAvailability',
    'sourceDigest',case when envelope->>'compiler_version'='approved-manual-period-v1'
      and envelope#>>'{adapter,schema}'='custodial.approved-manual-period-database-adapter.v1'
      and envelope#>>'{authority,schema}'='custodial.approved-manual-period-projection-authority.v1'
     then case when jsonb_typeof(envelope#>'{authority,sourceDigest}')='string'
      and envelope#>>'{authority,sourceDigest}'~'^[a-f0-9]{64}$'
      and envelope#>>'{authority,sourceDigest}'=public.static_weekly_digest_jsonb(envelope#>'{authority,compilerInput}')
      then envelope#>'{authority,sourceDigest}' else null end
     else case when jsonb_typeof(envelope#>'{authority,inputDigest}')='string'
      and envelope#>>'{authority,inputDigest}'~'^[a-f0-9]{64}$' then envelope#>'{authority,inputDigest}' else null end end,
    'sourceDigestBasis',case when envelope->>'compiler_version'='approved-manual-period-v1'
      and envelope#>>'{adapter,schema}'='custodial.approved-manual-period-database-adapter.v1'
      and envelope#>>'{authority,schema}'='custodial.approved-manual-period-projection-authority.v1'
     then 'envelope.authority.sourceDigest' else 'envelope.authority.inputDigest' end,
    'geographyDigest',case when jsonb_typeof(envelope#>'{authority,compilerInput,proximity}')='array'
     then public.static_weekly_digest_jsonb(envelope#>'{authority,compilerInput,proximity}') else null end,
    'geographyDigestBasis','envelope.authority.compilerInput.proximity');
   if octet_length(prepared_week::text)>4194304 then raise exception using errcode='54000',message='prepared preview week byte bound exceeded';end if;
   preview_weeks:=preview_weeks||jsonb_build_array(prepared_week);
   if octet_length(preview_weeks::text)>16777216 then raise exception using errcode='54000',message='prepared preview total byte bound exceeded';end if;
  end loop;
 end if;
 return jsonb_build_object('operation_id',command.operation_id,'state',command.state,
  'original_cancellation_target',original_target,
  'semantic_body',command.semantic_body,'semantic_digest',command.semantic_digest,
  'expected_revision',command.expected_revision,'prepared_by_manager_id',command.prepared_by_manager_id,
  'preview_digest',command.preview_digest,'candidate_set_digest',command.candidate_set_digest,
  'input_digest',command.input_digest,'publication_vector',command.publication_vector,
  'candidate_row_count',command.candidate_row_count,'candidate_bytes',command.candidate_bytes,
  'candidate_summary',command.candidate_summary,'accepted_revision',command.accepted_revision,
  'accepted_receipt',command.accepted_receipt,'created_at',command.created_at,'prepared_at',command.prepared_at,
  'accepted_at',command.accepted_at,'current_service_date',public.sch_service_date(statement_timestamp())::text,
  'preview',case when command.state='PREPARED' then jsonb_build_object(
   'schema','memphis-zoo.staffing-command-preview.v1',
   'weeks',preview_weeks)
   else null end);
end $function$;
-- Component SOURCE302_NATIVE_MANAGER_API_20261030.sql
create or replace function public.static_weekly_staffing_period_frames(p_operation uuid,p_manager uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare ctx jsonb;frames jsonb;
begin
 perform public.static_weekly_v3_assert_control_plane();
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 ctx:=public.static_weekly_pending_context(p_operation,p_manager);
 select jsonb_agg(jsonb_build_object('serviceDate',d::date::text,
  'frameStart',public.static_weekly_projection_window_start(d::date)::text) order by d) into frames
  from generate_series((ctx#>>'{originalCommand,semanticBody,startDate}')::date,
   (ctx#>>'{originalCommand,semanticBody,endDate}')::date,'1 day') d;
 return jsonb_build_object('schema','custodial.staffing-source-period-frames.v1','originalCommand',ctx->'originalCommand','frames',frames);
end $fn$;
revoke all on function public.static_weekly_staffing_period_frames(uuid,uuid) from public,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_staffing_period_frames(uuid,uuid) to static_weekly_control_plane;

create or replace function public.static_weekly_manual_projection_view_basis(p_manager uuid,p_projection uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare p public.weekly_schedule_compiled_projections%rowtype;current_state record;
begin
 perform public.static_weekly_v3_assert_control_plane();perform public.static_weekly_v3_manager_actor(p_manager);
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 select * into strict p from public.weekly_schedule_compiled_projections where projection_id=p_projection;
 select * into current_state from public.static_weekly_v6_schedule_authority_state(p.week_start);
 if current_state.projection_status is distinct from 'current' or current_state.projection_id is distinct from p.projection_id
  or p.compiler_version is distinct from 'approved-manual-period-v1'
  or p.projection_envelope#>>'{adapter,schema}' is distinct from 'custodial.approved-manual-period-database-adapter.v1'
 then raise exception using errcode='40001',message='Exact current manual dated projection required for manager display';end if;
 return jsonb_build_object('schema','custodial.approved-manual-projection-view-basis.v1','projectionId',p.projection_id,
  'publicationId',p.publication_id,'versionId',p.version_id,'frameStart',p.week_start::text,'frameEnd',p.week_end::text,
  'projectionAvailability',p.projection_envelope#>'{authority,projectionAvailability}');
end $fn$;
revoke all on function public.static_weekly_manual_projection_view_basis(uuid,uuid) from public,anon,authenticated,service_role,static_weekly_release_operator,custodial_application_reader;
grant execute on function public.static_weekly_manual_projection_view_basis(uuid,uuid) to static_weekly_control_plane;
commit;
