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
  ($v$custodial_quarantine_malformed_scan_http(text,text,integer,text)$v$,$v$4100aefc974f94150653d7c95ae54fb602b3026a3395ddb74b6b4147aa663280$v$,$v$a50c43f9ee359d06b14929373c8b1016204bc0f12ac9b1ff44d54df174e8b2fb$v$,$v$[
  [
    "'http-malformed-completion:' || substr(v_digest,1,45)",
    "extensions.uuid_generate_v5('585da078-4132-5700-8e31-9f955ffa9437'::uuid,v_digest)::text"
  ]
]$v$::jsonb),
  ($v$public.static_weekly_assert_exception_payload(text,date,time,time,uuid,uuid,jsonb,uuid)$v$,$v$8ce90ceb3652741ad6cf449a04afc303ba26510e754169ee4b2d41d9f58cde20$v$,$v$80b639baf00b5d77d8db7ff09faa2f8fb0345f37cd1ccb54a4a53a74ad0b7c00$v$,$v$[
  [
    "e.payload_digest=public.static_weekly_digest_jsonb(p_payload) and not exists(",
    "e.payload_digest=public.static_weekly_digest_jsonb(p_payload)\n    and (p_exception_type<>'partial_absence' or (e.starts_at is not distinct from p_starts_at and e.ends_at is not distinct from p_ends_at))\n    and not exists("
  ]
]$v$::jsonb),
  ($v$static_weekly_assert_approved_dated_projection(jsonb,uuid,date,jsonb)$v$,$v$e482463acc95faa07f37599b6dbcf04421636fb4eb65831eb3a28aed0ea18b2d$v$,$v$adb886ee0c79d7f9af66133c462bfce60c6eb7fe1e5e3bd540cbfe14abfb84e5$v$,$v$[
  [
    "actual_availability jsonb;role_profile jsonb;",
    "actual_availability jsonb;original_blocked jsonb;role_profile jsonb;"
  ],
  [
    "  actual_availability:=public.static_weekly_approved_dated_effective_availability",
    "  original_blocked:=coalesce(actual_availability->'blockedWindows','[]'::jsonb);\n  actual_availability:=public.static_weekly_approved_dated_effective_availability"
  ],
  [
    "  IF role_profile IS DISTINCT FROM actual_profile OR actual_availability",
    "  IF closing_enabled AND EXISTS(SELECT 1 FROM jsonb_array_elements(compiler_exceptions) e\n    WHERE e->>'type'='partial_absence' AND e->>'serviceDate'=operation_date::text\n      AND e#>>'{payload,slotId}'=mapping->>'actualSlotId') THEN\n   -- Compare the fixed role's baseline block pattern. The current availability,\n   -- interval and both budgets still enter the independent closing and duty checks.\n   actual_profile:=jsonb_set(actual_profile,'{blocked}',original_blocked)-'service'-'duty';\n   role_profile:=role_profile-'service'-'duty';\n  END IF;\n  IF role_profile IS DISTINCT FROM actual_profile OR actual_availability"
  ]
]$v$::jsonb),
  ($v$finish_operational_notification_job(uuid,uuid,boolean,text,integer)$v$,$v$2b632a438051eca941d3939003ea6bf50df9d10d01c5bcc0041384001fb7e6cf$v$,$v$bd308e8ed09efae24e676f442f9cf23f224a1ba37e037ee1a765ef295763ca68$v$,$v$[
  [
    "  return v_row;",
    "  if v_row.status='dead' and v_row.job_type='employee_native_push' then\n    perform public.ops_manager_enqueue_lunch_delivery_failure(v_row.job_id,now());\n  end if;\n  return v_row;"
  ]
]$v$::jsonb),
  ($v$custodial_feedback_delivery_status(uuid[])$v$,$v$7767c20f4d74b3a9566051f511bfbc638eeface71705b9744dd9e06cb0a96092$v$,$v$0616ede339f8b246e958411330fa3e5cdb29d1175d536810f3f82a970be81d7d$v$,$v$[
  [
    "coalesce(i.feedback_snapshot->'image_attachment'<>'null'::jsonb,false)",
    "coalesce(i.feedback_snapshot->'image_attachment'<>'null'::jsonb and i.state in ('queued','claimed')\n      and i.attachment_verification_state in ('unverified','pending') and i.attempt_id is null,false)"
  ]
]$v$::jsonb),
  ($v$feedback_email_relay_command(text,text,jsonb)$v$,$v$cee855c1204cbcb905b7922484efcb628f92a1a62aedf381b55ac94d0f647476$v$,$v$08dfbdf6f1c92f6838e8526bfd4eff1a243b1ab38f20d7164309dcf6724e8fc5$v$,$v$[
  [
    "where feedback_snapshot->'image_attachment' is not null and feedback_snapshot->'image_attachment'<>'null'::jsonb)",
    "where feedback_snapshot->'image_attachment'<>'null'::jsonb and state in ('queued','claimed')\n          and attachment_verification_state in ('unverified','pending') and attempt_id is null)"
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
COMMIT;
