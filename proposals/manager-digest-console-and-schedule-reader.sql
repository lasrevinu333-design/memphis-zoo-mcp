-- Held follow-up for the existing operational and Schedule functions. Each exact
-- definition and its matching recovery row advance together under the existing fences.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';
SET LOCAL search_path=pg_catalog,public;
SELECT custodial_dr.acquire_application_mutation_fence();
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
DO $patch$
DECLARE t record; pair jsonb; target oid; original text; successor text;
  saved public.custodial_release_authority_restore_inventory%rowtype;
  saved_owner oid; saved_acl aclitem[]; inventory constant regclass:='public.custodial_release_authority_restore_inventory'::regclass;
BEGIN
 IF current_user<>'postgres' OR current_user<>session_user OR current_setting('session_replication_role')<>'origin'
   OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=inventory AND tgname='trg_custodial_release_authority_restore_inventory_immutable'
     AND tgfoid='public.custodial_reject_release_authority_inventory_mutation()'::regprocedure AND tgenabled='A')
   OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=inventory AND tgname='custodial_disaster_restore_mutation_fence'
     AND tgfoid='custodial_dr.guard_application_mutation()'::regprocedure AND tgenabled IN ('A','O'))
   OR NOT EXISTS(SELECT 1 FROM pg_event_trigger WHERE evtname='custodial_dr_guard_application_ddl'
     AND evtfoid='custodial_dr.guard_application_ddl()'::regprocedure AND evtenabled IN ('A','O'))
 THEN RAISE EXCEPTION 'Original owner and inventory guards required';END IF;
 ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 FOR t IN SELECT * FROM (VALUES
  ($v$ops_manager_enqueue_scheduled_notifications(timestamp with time zone)$v$,$v$d9821bcc7e46bedcb1a458daad39f8fb907e3dc5eed885be5af2ac68607f3f98$v$,$v$2d7ef14fba48968a55866b0bf8f15bf07af668d555a0e3bef7d681adef522100$v$,$v$[
  [
    "  select count(*)::integer into v_event_count\n  from public.events_app_events e\n  cross join lateral public.app_event_manager_digest_candidate(e.id,p_now) candidate\n  where candidate.event_date<=v_local_date+v_target.event_lookahead_days;\n  if v_event_count>0 then\n    select e.id,candidate.event_revision,candidate.event_name,candidate.event_date,\n      candidate.display_location,candidate.occurrence_starts_at\n    into v_next_event\n    from public.events_app_events e\n    cross join lateral public.app_event_manager_digest_candidate(e.id,p_now) candidate\n    where candidate.event_date<=v_local_date+v_target.event_lookahead_days\n    order by candidate.occurrence_starts_at,candidate.event_name,e.id limit 1;\n",
    "  select e.id,candidate.event_revision,candidate.event_name,candidate.event_date,\n      candidate.display_location,candidate.occurrence_starts_at,count(*) over () as event_count\n    into v_next_event\n    from public.events_app_events e\n    cross join lateral public.app_event_manager_digest_candidate(e.id,p_now) candidate\n    where candidate.event_date<=v_local_date+v_target.event_lookahead_days\n    order by candidate.occurrence_starts_at,candidate.event_name,e.id limit 1;\n  if found then\n    v_event_count:=v_next_event.event_count;\n"
  ],
  [
    "    insert into public.ops_manager_notification_queue\n      (job_key,credential_id,manager_id,notification_type,title,body,data_json)\n    values('manager-event-digest:'",
    "    if exists(select 1 from public.ops_manager_notification_queue old\n      where old.credential_id=v_target.credential_id and old.manager_id=v_target.manager_id\n        and old.notification_type='event_digest' and not(old.data_json ? 'event_count')\n        and old.status in ('leased','sent') and old.data_json->>'next_event_id'=v_next_event.id::text\n        and old.data_json->>'next_event_revision'=v_next_event.event_revision::text\n        and (old.data_json->>'next_event_starts_at')::timestamptz=v_next_event.occurrence_starts_at\n        and old.data_json->>'next_event_display_location' is not distinct from v_next_event.display_location\n        and old.data_json->>'lookahead_days'=v_target.event_lookahead_days::text\n        and split_part(old.body,' ',1)=v_event_count::text) then null;\n    else\n    insert into public.ops_manager_notification_queue\n      (job_key,credential_id,manager_id,notification_type,title,body,data_json)\n    values('manager-event-digest:'"
  ],
  [
    "||':'||md5(coalesce(v_next_event.display_location,'')),",
    "||':'||md5(coalesce(v_next_event.display_location,''))||':'||v_event_count::text||':'||v_target.event_lookahead_days::text,"
  ],
  [
    "'lookahead_days',v_target.event_lookahead_days,'next_event_id'",
    "'lookahead_days',v_target.event_lookahead_days,'event_count',v_event_count,'next_event_id'"
  ],
  [
    "    get diagnostics v_event_count=row_count;v_inserted:=v_inserted+v_event_count;",
    "    get diagnostics v_event_count=row_count;v_inserted:=v_inserted+v_event_count;\n    end if;"
  ]
]$v$::jsonb),
  ($v$app_event_manager_digest_is_current(jsonb,timestamp with time zone)$v$,$v$9dc5bc5683421cf60e184b92b84602f7e1b28245d898bd41bb8e84bfc5898743$v$,$v$3b6adce3689b2a2ffe3f7dec80873d3dbd09d61ee3043bf41e8fe514899c655f$v$,$v$[
  [
    "  return exists(select 1 from public.app_event_manager_digest_candidate(v_id,p_at) candidate\n    where candidate.event_revision=v_revision and candidate.occurrence_starts_at=v_start\n      and candidate.display_location is not distinct from\n        nullif(p_payload->>'next_event_display_location',''));",
    "  if coalesce(p_payload->>'event_count','') !~ '^[1-9][0-9]{0,8}$'\n    or coalesce(p_payload->>'lookahead_days','') !~ '^([1-9]|[12][0-9]|30)$'\n    or coalesce(p_payload->>'service_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false;end if;\n  begin\n    return exists(select 1 from (\n      select e.id,c.*,count(*) over () as total from public.events_app_events e\n      cross join lateral public.app_event_manager_digest_candidate(e.id,p_at) c\n      where c.event_date<=(p_payload->>'service_date')::date+(p_payload->>'lookahead_days')::integer\n      order by c.occurrence_starts_at,c.event_name,e.id limit 1\n    ) current where current.id=v_id and current.total=(p_payload->>'event_count')::integer\n      and current.event_revision=v_revision and current.occurrence_starts_at=v_start\n      and current.display_location is not distinct from nullif(p_payload->>'next_event_display_location',''));\n  exception when datetime_field_overflow or invalid_datetime_format then return false;end;"
  ]
]$v$::jsonb),
  ($v$public.static_weekly_v25_read_current_recurring_delivery(date,uuid)$v$,$v$c2cf0da085cff2ac50fdc31df3bb5cb928252b68ae14f7bcda5ba5188f8af631$v$,$v$7da71718882a83d22f57e6eaf5e68db0991945d6ba8b73e9d5d942a01fa9b1d4$v$,$v$[
  [
    "and c.revoked_at is null and c.expires_at>statement_timestamp()",
    "and c.revoked_at is null and c.expires_at>statement_timestamp()\n     and not(c.metadata_json ? 'retained_original_enrollment')"
  ]
]$v$::jsonb),
  ($v$custodial_leadership_private.execute(text,jsonb)$v$,$v$075a72969b50ddded398a13bde16447dae60d2dc293fcf9cf74b467b60c50b13$v$,$v$43627fa1aafebaee5314d8133063679911c788c1ffeb289abe21412a71ad7d04$v$,$v$[
  [
    " IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text)>4096 THEN",
    " IF p_action='gemini_begin_turn' AND (jsonb_typeof(p_data#>'{input,body}') IS DISTINCT FROM 'string'\n   OR length(btrim(p_data#>>'{input,body}')) NOT BETWEEN 1 AND 30000\n   OR octet_length(p_data::text)>262144) THEN RETURN jsonb_build_object('ok',false,'error','invalid_gemini_turn_input');END IF;\n IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR (p_action IS DISTINCT FROM 'gemini_begin_turn' AND octet_length(p_data::text)>4096) THEN"
  ]
]$v$::jsonb),
  ($v$public.custodial_is_basecamp_birthday(jsonb)$v$,$v$8c7d0454ca472aff8ebdd7d1e2022fc577346417275947081cbe2d04e44018cf$v$,$v$5ec4bbf5805d65fce44b185335d305f9f375443d4cdd78cea79452a5842ce698$v$,$v$[
  [
    "coalesce(p_record->>'event_name' ~* '(^|[^a-z])(birthday|party|parties)([^a-z]|$)',false)",
    "(coalesce(p_record->>'event_name','') ~* '(^|[^a-z])birthday(s)?([^a-z]|$)'\n       AND coalesce(p_record->>'event_name','') !~* '(non[- ]?|not (a |an )?|no )birthday'\n    OR EXISTS (SELECT 1 FROM regexp_split_to_table(coalesce(p_record->>'source_text',''),E'[\\\\r\\\\n]+') line\n       WHERE line ~* '^\\s*(event type|occasion|ticket type|booking type|category)\\s*[:=]\\s*(child.?s?\\s+)?birthday(\\s+(party|celebration|booking|package))?\\s*$'\n         OR line ~* '^\\s*birthday( party)?\\s*[:=]\\s*(yes|true)\\s*$'\n         OR (line ~* '^\\s*(subject|event name|ticket title)\\s*:\\s*.*\\mbirthday\\M' AND line !~* '(non[- ]?|not (a |an )?|no )birthday')))"
  ]
]$v$::jsonb),
  ($v$public.static_weekly_v22_reconcile_recurring_application_date(date)$v$,$v$54a0778d62ccea3ec42ea8a1770ec42c1488420b93adcee51b85f056c0cac790$v$,$v$80937fa5479b746f9fc76e737f9bd19b17c6866994242e8a44698ca20e6b653c$v$,$v$[
  [
    "and c.expires_at>statement_timestamp()",
    "and c.expires_at>statement_timestamp() and not(c.metadata_json ? 'retained_original_enrollment')"
  ]
]$v$::jsonb)
 ) AS changes(identity,before_sha,after_sha,edits) LOOP
  SELECT * INTO STRICT saved FROM public.custodial_release_authority_restore_inventory WHERE object_kind='function' AND object_identity=t.identity;
  target:=t.identity::regprocedure;
  SELECT pg_get_functiondef(target),proowner,proacl INTO STRICT original,saved_owner,saved_acl FROM pg_proc WHERE oid=target;
  IF original IS DISTINCT FROM saved.definition_sql OR saved.definition_sha256 IS DISTINCT FROM t.before_sha
    OR public.static_weekly_digest_text(original) IS DISTINCT FROM t.before_sha THEN RAISE EXCEPTION 'Unexpected original for %',t.identity;END IF;
  successor:=original;
  FOR pair IN SELECT value FROM jsonb_array_elements(t.edits) LOOP
   successor:=replace(successor,pair->>0,pair->>1);
  END LOOP;
  IF public.static_weekly_digest_text(successor) IS DISTINCT FROM t.after_sha THEN RAISE EXCEPTION 'Unexpected successor for %',t.identity;END IF;
  EXECUTE successor;
  IF pg_get_functiondef(target) IS DISTINCT FROM successor OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=target AND proowner=saved_owner AND proacl IS NOT DISTINCT FROM saved_acl)
   THEN RAISE EXCEPTION 'Function or grant mismatch for %',t.identity;END IF;
  UPDATE public.custodial_release_authority_restore_inventory SET definition_sql=successor,definition_sha256=t.after_sha,captured_at=statement_timestamp()
   WHERE inventory_id=saved.inventory_id AND definition_sha256=t.before_sha;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lost recovery row for %',t.identity;END IF;
 END LOOP;
 ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
END $patch$;
DO $manual_off_day_targets$
DECLARE
 target regprocedure:='custodial_coverall.reconcile_manual_application_date(date)'::regprocedure;
 original_definition text;next_definition text;original_body text;next_body text;
 before_metadata jsonb;after_metadata jsonb;role_name text;
 old_body text;new_body text;
BEGIN
 IF current_user NOT IN('postgres','supabase_admin')
  OR (SELECT proowner FROM pg_proc WHERE oid=target) IS DISTINCT FROM current_user::regrole
 THEN RAISE EXCEPTION 'Exact existing manual target function owner required';END IF;
 PERFORM public.custodial_begin_application_mutation();
 PERFORM pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 SELECT prosrc,to_jsonb(p)-'prosrc' INTO STRICT original_body,before_metadata FROM pg_proc p WHERE p.oid=target;
 old_body:=original_body;new_body:=replace(old_body,$target$and c.expires_at>statement_timestamp()$target$,$target$and c.expires_at>statement_timestamp() and not(c.metadata_json ? 'retained_original_enrollment')$target$);
 IF public.static_weekly_digest_text(original_body) IS DISTINCT FROM '7bf3ee3a83585aebc22ff0a13a47256a711b46c3cd884dbf3b2e19b68c7792c2'
  OR (SELECT prosecdef FROM pg_proc WHERE oid=target) IS DISTINCT FROM true
  OR (SELECT proconfig FROM pg_proc WHERE oid=target) IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
  OR (SELECT provolatile FROM pg_proc WHERE oid=target) IS DISTINCT FROM 'v'::"char"
  OR (SELECT prorettype FROM pg_proc WHERE oid=target) IS DISTINCT FROM 'integer'::regtype
 THEN RAISE EXCEPTION 'Exact manual target predecessor body/security differs; no repair applied';END IF;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role','static_weekly_control_plane','static_weekly_release_operator','custodial_application_reader'] LOOP
  IF has_function_privilege(role_name,target,'EXECUTE')
  THEN RAISE EXCEPTION 'Exact private manual target execute boundary differs; no repair applied';END IF;
 END LOOP;
 -- This existing owner-private function is included in complete private-schema
 -- backups. An unexpected separate release-recovery row requires its owning
 -- exact rebind; never leave such a row stale or weaken its immutable trigger.
 IF EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory i
  WHERE CASE WHEN i.object_kind='function' OR (i.object_kind='grant' AND position('(' IN i.object_identity)>0)
   THEN to_regprocedure(i.object_identity) END=target)
 THEN RAISE EXCEPTION 'Manual target has a retained release recovery entry; exact rebind required before repair';END IF;
 original_definition:=pg_get_functiondef(target);
 IF (length(original_definition)-length(replace(original_definition,old_body,'')))<>length(old_body)
  OR public.static_weekly_digest_text(new_body) IS DISTINCT FROM 'e3a5ca7b7d44f8d25c71037c10240beed7147e16c08816dc40d8fca9a34a88b0'
 THEN RAISE EXCEPTION 'Exact manual OFF target substitution differs';END IF;
 next_definition:=replace(original_definition,old_body,new_body);
 IF replace(next_definition,new_body,old_body) IS DISTINCT FROM original_definition
 THEN RAISE EXCEPTION 'Exact manual OFF target inverse differs';END IF;
 EXECUTE next_definition;
 SELECT prosrc,to_jsonb(p)-'prosrc' INTO STRICT next_body,after_metadata FROM pg_proc p WHERE p.oid=target;
 IF next_body IS DISTINCT FROM new_body OR public.static_weekly_digest_text(next_body) IS DISTINCT FROM 'e3a5ca7b7d44f8d25c71037c10240beed7147e16c08816dc40d8fca9a34a88b0'
  OR before_metadata IS DISTINCT FROM after_metadata
  OR pg_get_functiondef(target) IS DISTINCT FROM next_definition
 THEN RAISE EXCEPTION 'Manual target owner/ACL/attributes/body changed beyond exact OFF repair';END IF;
END $manual_off_day_targets$;
COMMIT;
