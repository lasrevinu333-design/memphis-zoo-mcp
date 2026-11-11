-- UNAPPLIED SOURCE / isolated prototype. A complete review is DATA, not an
-- inventory ACK, finalizer capability, current native holder or key authority.
-- Accepted completion rows are re-read using ORIGINAL argument UTF8 under the
-- existing purpose-specific current original reader, never copied readbacks.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE FUNCTION custodial_recovery.inventory_object_keys(v jsonb,expected text[]) RETURNS boolean
 LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $fn$
 SELECT CASE WHEN jsonb_typeof(v)='object' THEN
  (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(v) k)
  IS NOT DISTINCT FROM (SELECT array_agg(k ORDER BY k COLLATE "C") FROM unnest(expected) k)
 ELSE false END
$fn$;
CREATE FUNCTION custodial_recovery.inventory_count(v jsonb,maximum bigint) RETURNS boolean
 LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $fn$
 SELECT CASE WHEN jsonb_typeof(v)='number' AND v::text ~ '^(0|[1-9][0-9]*)$'
  THEN v::text::numeric<=maximum ELSE false END
$fn$;

CREATE FUNCTION custodial_recovery.inventory_completion_current(c jsonb,disposition text,target jsonb)
 RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE op public.custodial_native_private_custody_operations%rowtype;
 cred public.device_auth_credentials%rowtype;part public.custodial_native_private_custody_chunks%rowtype;
 actual text;raw text;observed jsonb;BEGIN
 IF c='null'::jsonb THEN
  IF disposition IS DISTINCT FROM 'UNRESOLVED_RETAINED' THEN
   RAISE EXCEPTION USING errcode='42501',message='accepted original requires its exact argument source';END IF;
  RETURN;
 END IF;
 IF NOT custodial_recovery.inventory_object_keys(c,ARRAY['argument_sha256','original_query_request_id',
  'request_body_sha256','actual_response_sha256','readback','original_arguments_utf8'])
  OR EXISTS(SELECT 1 FROM jsonb_each(c) e WHERE e.key<>'readback' AND jsonb_typeof(e.value) IS DISTINCT FROM 'string')
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['argument_sha256','request_body_sha256','actual_response_sha256']) k
   WHERE c->>k !~ '^[a-f0-9]{64}$')
  OR octet_length(c->>'original_query_request_id') NOT BETWEEN 1 AND 65536
  OR octet_length(c->>'original_arguments_utf8') NOT BETWEEN 1 AND 4194304 THEN
  RAISE EXCEPTION USING errcode='22023',message='bounded exact completion argument source required';END IF;
 raw:=c->>'original_arguments_utf8';observed:=c->'readback';
 IF encode(extensions.digest(convert_to(raw,'UTF8'),'sha256'),'hex') IS DISTINCT FROM c->>'argument_sha256'
  OR NOT custodial_recovery.inventory_object_keys(observed,ARRAY['schema','state','operation_id','original_generation_id',
   'argument_values_sha256','disposition','result','transaction_authority','limits'])
  OR observed->>'schema' IS DISTINCT FROM 'custodial.same-original-completion-SQL-read.v1'
  OR observed->>'state' IS DISTINCT FROM 'CURRENT_EXACT_ORIGINAL_COMPLETION_DISPOSITION_NOT_ACK'
  OR observed->>'operation_id' IS DISTINCT FROM target->>'operation_id'
  OR observed->>'original_generation_id' IS DISTINCT FROM target->>'original_generation_id'
  OR observed->>'argument_values_sha256' IS DISTINCT FROM c->>'argument_sha256'
  OR observed->'transaction_authority' IS DISTINCT FROM 'false'::jsonb
  OR observed->'limits' IS DISTINCT FROM custodial_recovery.denied_effects() THEN
  RAISE EXCEPTION USING errcode='42501',message='exact original completion source changed';END IF;
 IF disposition='UNRESOLVED_RETAINED' THEN
  IF observed->>'disposition' IS DISTINCT FROM 'UNRESOLVED_RETAINED' OR observed->'result' IS DISTINCT FROM 'null'::jsonb THEN
   RAISE EXCEPTION USING errcode='42501',message='unresolved original must remain retained';END IF;
  -- A later acceptance cannot turn this saved unknown into a deletion/ACK.
  -- It deliberately remains unknown and retained in this original manifest.
  RETURN;
 END IF;
 IF disposition IS DISTINCT FROM 'CURRENT_ACCEPTED_EXACT_ORIGINAL_NOT_ACK'
  OR observed->>'disposition' IS DISTINCT FROM 'ACCEPTED_EXACT_ORIGINAL' THEN
  RAISE EXCEPTION USING errcode='42501',message='closed original completion disposition required';END IF;
 SELECT * INTO STRICT op FROM public.custodial_native_private_custody_operations WHERE operation_id=(target->>'operation_id')::uuid;
 SELECT * INTO STRICT cred FROM public.device_auth_credentials WHERE credential_id=op.credential_id AND device_id=op.device_id;
 SELECT * INTO STRICT part FROM public.custodial_native_private_custody_chunks WHERE operation_id=op.operation_id AND chunk_index=0;
 -- Arguments are the archived exact bytes. Native request/body/attestation
 -- pins come from the actual immutable retained WRITE, not the manifest's
 -- claimed query IDs/digests. Existing SQL owns all accepted-record semantics.
 actual:=custodial_recovery.read_original_completion(op.operation_id,op.device_id,op.credential_id,cred.token_hash,
  cred.metadata_json->>'credential_secret_key_id',op.generation_id,0,part.native_request_id,
  part.request_body_sha256,part.attestation_digest,raw);
 IF actual IS NULL OR actual::jsonb IS DISTINCT FROM observed THEN
  RAISE EXCEPTION USING errcode='42501',message='current exact original accepted readback required';END IF;
END $fn$;

CREATE FUNCTION custodial_recovery.review_original_inventory(
 p_manager uuid,p_credential uuid,p_device text,p_signed_expires timestamptz,
 p_security_session uuid,p_password_version integer,p_security_hash text,p_csrf_hash text,p_inventory_request uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE source jsonb;manifest jsonb;raw text;bad boolean;target jsonb;intent jsonb;row jsonb;item jsonb;domain jsonb;
 names constant text[]:=ARRAY['MemphisZooCustodialNativeProviderV1','MemphisZooCustodialNativeVaultV1','MemphisZooCustodialNativeVaultV2',
  'MemphisZooCustodialOfflineAuthorityTimeV1','MemphisZooCustodialRetainedAttemptV1','MemphisZooCustodialRetainedBatchV1',
  'MemphisZooCustodialRetainedReadQueryV1','WSSecureStorageSharedPreferences'];
 families constant text[]:=ARRAY['SEPARATE_PROVIDER_V1','LEGACY_VAULT_V1','SHARED_VAULT_V2','SHARED_VAULT_V2',
  'SHARED_VAULT_V2','SHARED_VAULT_V2','SHARED_VAULT_V2','LEGACY_ALIAS_BOUND_SECURE_STORAGE'];
 totals integer[]:=ARRAY[0,0,0,0,0,0,0,0];accepted integer[]:=ARRAY[0,0,0,0,0,0,0,0];
 ordinal integer:=0;idx integer;prior integer:=0;db_count integer:=0;stores integer:=0;domain_counts integer[];
 database_bytes bytea;store_bytes bytea;prior_db bytea;prior_store bytea;db_version bigint;empty_db boolean:=false;
 browser_accepted integer:=0;family_total integer;frame jsonb;summary jsonb;review jsonb;reviewed timestamptz;expiry timestamptz;
 parent public.custodial_native_inventory_requests%rowtype;employee_label text;BEGIN
 source:=custodial_recovery.read_original_inventory_manifest_for_manager(p_manager,p_credential,p_device,p_signed_expires,
  p_security_session,p_password_version,p_security_hash,p_csrf_hash,p_inventory_request);
 IF source IS NULL THEN RETURN NULL;END IF;
 raw:=source->>'manifest_utf8';
 -- Reject duplicate fields and non-integer numeric spellings BEFORE jsonb
 -- conversion; original completion JSON remains an opaque STRING until the
 -- fixed exact reader handles it, preserving arbitrary numeric DATA.
 WITH RECURSIVE nodes(v,d) AS (
  SELECT raw::json,0 UNION ALL SELECT child.v,n.d+1 FROM nodes n CROSS JOIN LATERAL (
   SELECT value v FROM json_each(CASE WHEN json_typeof(n.v)='object' THEN n.v ELSE '{}'::json END)
   UNION ALL SELECT value FROM json_array_elements(CASE WHEN json_typeof(n.v)='array' THEN n.v ELSE '[]'::json END)
  ) child WHERE n.d<=24
 ) SELECT count(*)>2000000 OR coalesce(max(d),0)>24 OR coalesce(bool_or(
  CASE WHEN json_typeof(v)='object' THEN (SELECT count(*)<>count(DISTINCT key COLLATE "C") FROM json_each(v))
   WHEN json_typeof(v)='number' THEN v::text !~ '^(0|[1-9][0-9]*)$' OR v::text::numeric>9007199254740991
   ELSE false END),false) INTO bad FROM nodes;
 IF bad THEN RAISE EXCEPTION USING errcode='22023',message='bounded unambiguous original inventory required';END IF;
 manifest:=raw::jsonb;target:=source#>'{expected_original,original_target}';
 IF NOT custodial_recovery.inventory_object_keys(manifest,ARRAY['schema','state','native_request_id',
  'registration_request_body_sha256','intent_document_sha256','intent_disk_sha256','original_target','native_held_stamp',
  'native_namespaces','native_records','browser_realm_name_encoding','browser_domains','browser_records','browser_value_frame',
  'browser_part_set_sha256','browser_accepted_exact_original_count','browser_unresolved_retained_count','retained_key_families',
  'inventory_acknowledged','work_accepted','replay_allowed','finalizer_allowed','key_removal','phone_released'])
  OR manifest->>'schema' IS DISTINCT FROM 'custodial.native-original-complete-inventory-manifest.v2'
  OR manifest->>'state' IS DISTINCT FROM 'ALL_DECLARED_ORIGINAL_ROWS_WITH_EXPLICIT_UNRESOLVED_RETENTION_NOT_ACK'
  OR manifest->>'native_request_id' IS DISTINCT FROM p_inventory_request::text OR manifest->'original_target' IS DISTINCT FROM target
  OR EXISTS(SELECT 1 FROM jsonb_each(custodial_recovery.denied_effects()) e WHERE manifest->e.key IS DISTINCT FROM e.value)
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['registration_request_body_sha256','intent_document_sha256','intent_disk_sha256']) k
   WHERE manifest->k IS DISTINCT FROM source#>ARRAY['expected_original',k])
  OR jsonb_typeof(manifest->'native_namespaces') IS DISTINCT FROM 'array' OR jsonb_array_length(manifest->'native_namespaces')<>8
  OR jsonb_typeof(manifest->'native_records') IS DISTINCT FROM 'array' OR jsonb_array_length(manifest->'native_records')>32768
  OR jsonb_typeof(manifest->'browser_domains') IS DISTINCT FROM 'array' OR jsonb_array_length(manifest->'browser_domains') NOT BETWEEN 2 AND 4098
  OR jsonb_typeof(manifest->'browser_records') IS DISTINCT FROM 'array' OR jsonb_array_length(manifest->'browser_records')>4096
  OR jsonb_typeof(manifest->'retained_key_families') IS DISTINCT FROM 'array' OR jsonb_array_length(manifest->'retained_key_families')<>4 THEN
  RAISE EXCEPTION USING errcode='42501',message='complete exact original v2 semantic source required';END IF;
 SELECT * INTO STRICT parent FROM public.custodial_native_inventory_requests WHERE native_request_id=p_inventory_request;
 intent:=((parent.original_request_utf8::jsonb)->>'original_intent_utf8')::jsonb;
 IF manifest->'native_held_stamp' IS DISTINCT FROM intent->'native_held_stamp'
  OR manifest#>'{browser_value_frame,frame_sha256}' IS DISTINCT FROM intent->'browser_frame_sha256'
  OR manifest->'browser_part_set_sha256' IS DISTINCT FROM intent->'browser_part_set_sha256' THEN
  RAISE EXCEPTION USING errcode='42501',message='original native/browser hold pins changed';END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(manifest->'native_records') LOOP
  idx:=array_position(names,row->>'namespace');
  IF NOT custodial_recovery.inventory_object_keys(row,ARRAY['ordinal','namespace','key_family','raw_identity_sha256',
    'raw_type','local_source_classification','disposition','completion_readback']) OR idx IS NULL OR idx<prior
   OR row->'ordinal' IS DISTINCT FROM to_jsonb(ordinal) OR row->>'key_family' IS DISTINCT FROM families[idx]
   OR jsonb_typeof(row->'raw_identity_sha256') IS DISTINCT FROM 'string' OR row->>'raw_identity_sha256' !~ '^[a-f0-9]{64}$'
   OR coalesce(row->>'raw_type','') NOT IN ('STRING','INTEGER','LONG','BOOLEAN','FLOAT_RAW_BITS','STRING_SET')
   OR jsonb_typeof(row->'local_source_classification') IS DISTINCT FROM 'string'
   OR row->>'local_source_classification' !~ '^[A-Z0-9_]{1,160}$'
   OR coalesce(row->>'disposition','') NOT IN ('CURRENT_ACCEPTED_EXACT_ORIGINAL_NOT_ACK','UNRESOLVED_RETAINED')
   OR row->'completion_readback'<>'null'::jsonb AND idx<>3 THEN
   RAISE EXCEPTION USING errcode='22023',message='closed original native inventory row required';END IF;
  totals[idx]:=totals[idx]+1;IF totals[idx]>4096 THEN RAISE EXCEPTION USING errcode='22023',message='native inventory bounds';END IF;
  PERFORM custodial_recovery.inventory_completion_current(row->'completion_readback',row->>'disposition',target);
  IF row->>'disposition'='CURRENT_ACCEPTED_EXACT_ORIGINAL_NOT_ACK' THEN accepted[idx]:=accepted[idx]+1;END IF;
  prior:=idx;ordinal:=ordinal+1;
 END LOOP;
 IF (SELECT count(*)<>count(DISTINCT (value->>'namespace',value->>'raw_identity_sha256'))
  FROM jsonb_array_elements(manifest->'native_records')) THEN
  RAISE EXCEPTION USING errcode='22023',message='duplicate original native identity';END IF;
 FOR idx IN 1..8 LOOP
  item:=manifest->'native_namespaces'->(idx-1);
  IF NOT custodial_recovery.inventory_object_keys(item,ARRAY['namespace','record_count','accepted_exact_original_count','unresolved_retained_count'])
   OR item IS DISTINCT FROM jsonb_build_object('namespace',names[idx],'record_count',totals[idx],
    'accepted_exact_original_count',accepted[idx],'unresolved_retained_count',totals[idx]-accepted[idx]) THEN
   RAISE EXCEPTION USING errcode='22023',message='complete exact native partitions required';END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(manifest->'retained_key_families') LOOP
  SELECT coalesce(sum(totals[n]),0) INTO family_total FROM generate_series(1,8) n WHERE families[n]=item->>'key_family';
  IF NOT custodial_recovery.inventory_object_keys(item,ARRAY['key_family','source_declared_raw_rows_to_preserve',
    'possible_undeclared_references','all_writer_durable_freeze_or_ABA_guard','current_server_reconciliation',
    'zero_rows_is_not_key_removal_authority','finalizer_allowed','key_removal'])
   OR coalesce(item->>'key_family','') NOT IN ('SEPARATE_PROVIDER_V1','LEGACY_VAULT_V1','SHARED_VAULT_V2','LEGACY_ALIAS_BOUND_SECURE_STORAGE')
   OR item->'source_declared_raw_rows_to_preserve' IS DISTINCT FROM to_jsonb(family_total)
   OR item->>'possible_undeclared_references' IS DISTINCT FROM 'UNKNOWN'
   OR item->'zero_rows_is_not_key_removal_authority' IS DISTINCT FROM 'true'::jsonb
   OR EXISTS(SELECT 1 FROM unnest(ARRAY['all_writer_durable_freeze_or_ABA_guard','current_server_reconciliation','finalizer_allowed','key_removal']) k
    WHERE item->k IS DISTINCT FROM 'false'::jsonb) THEN
   RAISE EXCEPTION USING errcode='42501',message='all original referenced keys must remain retained';END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'key_family') FROM jsonb_array_elements(manifest->'retained_key_families'))<>4 THEN
  RAISE EXCEPTION USING errcode='22023',message='complete key family coverage required';END IF;
 ordinal:=0;domain_counts:=array_fill(0,ARRAY[jsonb_array_length(manifest->'browser_domains')]);
 FOR domain IN SELECT value FROM jsonb_array_elements(manifest->'browser_domains') LOOP
  IF NOT custodial_recovery.inventory_object_keys(domain,ARRAY['domain_ordinal','store','database_utf16be_base64','version',
    'object_store_utf16be_base64','record_count','state']) OR domain->'domain_ordinal' IS DISTINCT FROM to_jsonb(ordinal) THEN
   RAISE EXCEPTION USING errcode='22023',message='exact declared browser domain required';END IF;
  IF ordinal<2 THEN
   IF domain->>'store' IS DISTINCT FROM (CASE ordinal WHEN 0 THEN 'localStorage' ELSE 'sessionStorage' END)
    OR domain->'database_utf16be_base64' IS DISTINCT FROM 'null'::jsonb OR domain->'version' IS DISTINCT FROM 'null'::jsonb
    OR domain->'object_store_utf16be_base64' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION USING errcode='22023',message='exact local/session domain required';END IF;
   IF ordinal=1 AND domain->>'state'='UNAVAILABLE_UNRESOLVED_RETAINED' THEN
    IF domain->'record_count' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION USING errcode='22023',message='unavailable session is unknown';END IF;
   ELSIF domain->>'state' IS DISTINCT FROM 'DECLARED_ORIGINAL_ROWS_NOT_AUTHORITY'
    OR NOT custodial_recovery.inventory_count(domain->'record_count',4096) THEN
    RAISE EXCEPTION USING errcode='22023',message='bounded declared browser rows required';
   END IF;
  ELSE
   IF domain->>'store' IS DISTINCT FROM 'indexedDB' OR jsonb_typeof(domain->'database_utf16be_base64') IS DISTINCT FROM 'string'
    OR NOT custodial_recovery.inventory_count(domain->'version',9007199254740991) OR (domain->>'version')::bigint<1
    OR NOT custodial_recovery.inventory_count(domain->'record_count',4096) THEN
    RAISE EXCEPTION USING errcode='22023',message='bounded exact IndexedDB domain required';END IF;
   database_bytes:=decode(domain->>'database_utf16be_base64','base64');
   IF octet_length(database_bytes)>2048 OR mod(octet_length(database_bytes),2)<>0
    OR replace(encode(database_bytes,'base64'),E'\n','') IS DISTINCT FROM domain->>'database_utf16be_base64' THEN
    RAISE EXCEPTION USING errcode='22023',message='lossless original database name required';END IF;
   IF prior_db IS NULL OR database_bytes<>prior_db THEN
    IF prior_db IS NOT NULL AND database_bytes<=prior_db THEN RAISE EXCEPTION USING errcode='22023',message='database ordering';END IF;
    db_count:=db_count+1;IF db_count>32 THEN RAISE EXCEPTION USING errcode='22023',message='database bounds';END IF;
    prior_db:=database_bytes;db_version:=(domain->>'version')::bigint;prior_store:=NULL;stores:=0;empty_db:=false;
   ELSIF db_version<>(domain->>'version')::bigint OR empty_db THEN
    RAISE EXCEPTION USING errcode='22023',message='exact database version/store declaration required';END IF;
   IF domain->'object_store_utf16be_base64'='null'::jsonb THEN
    IF stores<>0 OR domain->>'state' IS DISTINCT FROM 'DECLARED_EMPTY_DATABASE_NOT_AUTHORITY' OR domain->'record_count'<>'0'::jsonb THEN
     RAISE EXCEPTION USING errcode='22023',message='empty database is not an empty store';END IF;empty_db:=true;
   ELSE
    IF jsonb_typeof(domain->'object_store_utf16be_base64') IS DISTINCT FROM 'string'
     OR domain->>'state' IS DISTINCT FROM 'DECLARED_ORIGINAL_ROWS_NOT_AUTHORITY' THEN
     RAISE EXCEPTION USING errcode='22023',message='original object store declaration required';END IF;
    store_bytes:=decode(domain->>'object_store_utf16be_base64','base64');
    IF octet_length(store_bytes)>8388608 OR mod(octet_length(store_bytes),2)<>0
     OR replace(encode(store_bytes,'base64'),E'\n','') IS DISTINCT FROM domain->>'object_store_utf16be_base64'
     OR prior_store IS NOT NULL AND store_bytes<=prior_store THEN
     RAISE EXCEPTION USING errcode='22023',message='lossless ordered original store name required';END IF;
    stores:=stores+1;IF stores>128 THEN RAISE EXCEPTION USING errcode='22023',message='store bounds';END IF;prior_store:=store_bytes;
   END IF;
  END IF;
  ordinal:=ordinal+1;
 END LOOP;
 ordinal:=0;prior:=0;
 FOR row IN SELECT value FROM jsonb_array_elements(manifest->'browser_records') LOOP
  IF NOT custodial_recovery.inventory_object_keys(row,ARRAY['ordinal','domain_ordinal','key_sha256','body_sha256','disposition','completion_readback'])
   OR row->'ordinal' IS DISTINCT FROM to_jsonb(ordinal)
   OR NOT custodial_recovery.inventory_count(row->'domain_ordinal',jsonb_array_length(manifest->'browser_domains')-1)
   OR coalesce(row->>'disposition','') NOT IN ('CURRENT_ACCEPTED_EXACT_ORIGINAL_NOT_ACK','UNRESOLVED_RETAINED')
   OR EXISTS(SELECT 1 FROM unnest(ARRAY['key_sha256','body_sha256']) k WHERE jsonb_typeof(row->k) IS DISTINCT FROM 'string' OR row->>k !~ '^[a-f0-9]{64}$') THEN
   RAISE EXCEPTION USING errcode='22023',message='closed original browser row required';END IF;
  idx:=(row->>'domain_ordinal')::integer;domain:=manifest->'browser_domains'->idx;
  IF idx<prior OR domain->'record_count'='null'::jsonb THEN RAISE EXCEPTION USING errcode='22023',message='declared original browser row order';END IF;
  domain_counts[idx+1]:=domain_counts[idx+1]+1;
  IF row->'completion_readback'<>'null'::jsonb AND (domain->>'store' IS DISTINCT FROM 'indexedDB'
   OR domain->>'database_utf16be_base64' IS DISTINCT FROM 'AG0AegBfAHMAYwBhAG4AXwBxAHUAZQB1AGU='
   OR domain->>'object_store_utf16be_base64' IS DISTINCT FROM 'AGEAYwB0AGkAbwBuAHM='
   OR (domain->>'version')::bigint NOT BETWEEN 1 AND 6) THEN
   RAISE EXCEPTION USING errcode='42501',message='only actual scan queue completion rows can be accepted';END IF;
  PERFORM custodial_recovery.inventory_completion_current(row->'completion_readback',row->>'disposition',target);
  IF row->>'disposition'='CURRENT_ACCEPTED_EXACT_ORIGINAL_NOT_ACK' THEN browser_accepted:=browser_accepted+1;END IF;
  prior:=idx;ordinal:=ordinal+1;
 END LOOP;
 FOR idx IN 1..array_length(domain_counts,1) LOOP
  IF domain_counts[idx]<>coalesce((manifest->'browser_domains'->(idx-1)->>'record_count')::integer,0) THEN
   RAISE EXCEPTION USING errcode='22023',message='complete original browser domain coverage required';END IF;
 END LOOP;
 IF manifest->'browser_accepted_exact_original_count' IS DISTINCT FROM to_jsonb(browser_accepted)
  OR manifest->'browser_unresolved_retained_count' IS DISTINCT FROM to_jsonb(ordinal-browser_accepted)
  OR manifest->>'browser_realm_name_encoding' IS DISTINCT FROM 'UTF16_CODE_UNITS_BE_BASE64' THEN
  RAISE EXCEPTION USING errcode='22023',message='complete original browser partitions required';END IF;
 frame:=manifest->'browser_value_frame';
 IF NOT custodial_recovery.inventory_object_keys(frame,ARRAY['schema','encoding','observation_sha256','frame_sha256',
   'byte_count','chunk_bytes','chunk_count','record_count','session_storage_state','chunk_sha256',
   'native_authority','durable_retention','inventory_acknowledged','finalizer_allowed','key_removal'])
  OR frame->>'schema' IS DISTINCT FROM 'custodial.browser-original-value-frame.v1' OR frame->>'encoding' IS DISTINCT FROM 'MZBRV001'
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['observation_sha256','frame_sha256']) k WHERE jsonb_typeof(frame->k) IS DISTINCT FROM 'string' OR frame->>k !~ '^[a-f0-9]{64}$')
  OR NOT custodial_recovery.inventory_count(frame->'byte_count',67108864) OR (frame->>'byte_count')::bigint<56
  OR frame->'chunk_bytes' IS DISTINCT FROM '1048576'::jsonb OR frame->'record_count' IS DISTINCT FROM to_jsonb(ordinal)
  OR frame->'chunk_count' IS DISTINCT FROM to_jsonb(((frame->>'byte_count')::integer+1048575)/1048576)
  OR jsonb_typeof(frame->'chunk_sha256') IS DISTINCT FROM 'array'
  OR jsonb_array_length(frame->'chunk_sha256')<>(frame->>'chunk_count')::integer
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(frame->'chunk_sha256') v WHERE jsonb_typeof(v) IS DISTINCT FROM 'string' OR v#>>'{}' !~ '^[a-f0-9]{64}$')
  OR frame->'chunk_count'='1'::jsonb AND frame#>'{chunk_sha256,0}' IS DISTINCT FROM frame->'frame_sha256'
  OR frame->>'session_storage_state' IS DISTINCT FROM (CASE WHEN manifest#>'{browser_domains,1,record_count}'='null'::jsonb
    THEN 'NOT_DECLARED_UNKNOWN' ELSE 'CAPTURED_READ_ONLY_NOT_AUTHENTICATED' END)
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['native_authority','durable_retention','inventory_acknowledged','finalizer_allowed','key_removal']) k
   WHERE frame->k IS DISTINCT FROM 'false'::jsonb) THEN
  RAISE EXCEPTION USING errcode='42501',message='exact retained original browser frame required';END IF;
 -- Reopen both current sources AFTER all potentially expensive exact reads.
 IF source#>'{expected_original}' IS DISTINCT FROM
   (custodial_recovery.read_original_inventory_manifest_for_manager(p_manager,p_credential,p_device,p_signed_expires,
     p_security_session,p_password_version,p_security_hash,p_csrf_hash,p_inventory_request))->'expected_original' THEN
  RAISE EXCEPTION USING errcode='42501',message='original inventory source changed during review';END IF;
 SELECT max(registered_at) INTO STRICT reviewed FROM public.custodial_native_inventory_manifest_chunks
  WHERE inventory_native_request_id=p_inventory_request;
 expiry:=least(reviewed+interval '5 minutes',(source->>'current_until')::timestamptz,
  custodial_recovery.assert_inventory_manager_read(p_manager,p_credential,p_device,p_signed_expires,
   p_security_session,p_password_version,p_security_hash,p_csrf_hash));
 IF clock_timestamp()>=expiry THEN RAISE EXCEPTION USING errcode='42501',message='original inventory review expired';END IF;
 SELECT display_name INTO STRICT employee_label FROM public.employees WHERE id=(target->>'employee_id')::uuid;
 IF nullif(btrim(employee_label),'') IS NULL OR length(employee_label)>200 THEN
  RAISE EXCEPTION USING errcode='42501',message='original human employee label unavailable';END IF;
 summary:=jsonb_build_object('declared_domains',jsonb_array_length(manifest->'browser_domains'),'record_count',ordinal,
  'accepted_exact_original_count',browser_accepted,'unresolved_retained_count',ordinal-browser_accepted,
  'frame_sha256',frame->>'frame_sha256','part_set_sha256',manifest->>'browser_part_set_sha256');
 review:=jsonb_build_object('schema','custodial.original-inventory-separation-review.v1',
  'state','COMPLETE_ORIGINAL_INVENTORY_REVIEW_ONLY','purpose','AUTHORIZE_EXACT_ORIGINAL_RETAINED_INVENTORY_SEPARATION',
  'native_request_id',p_inventory_request,'original_target',target,'original_employee_label',employee_label,
  'original_device_label',target->>'canonical_device_id','registration_receipt_sha256',source->>'original_registration_receipt_sha256',
  'inventory_manifest_sha256',source#>>'{expected_original,manifest_sha256}',
  'issuer',jsonb_build_object('manager_id',p_manager,'manager_credential_id',p_credential,'manager_device_id',p_device),
  'native_namespaces',manifest->'native_namespaces','browser_summary',summary,'retained_key_family_count',4,
  'reviewed_at',custodial_recovery.utc_micros(reviewed),'expires_at',custodial_recovery.utc_micros(expiry),
  'limits',custodial_recovery.denied_effects());
 -- Stable review identity binds the fixed original source and issuer. The
 -- bounded observation timestamps cannot renew/change an original decision.
 RETURN review||jsonb_build_object('review_sha256',encode(extensions.digest(convert_to(
  'custodial.original-inventory-separation-review.v1'||E'\n'||(review-'reviewed_at'-'expires_at')::text,'UTF8'),'sha256'),'hex'));
END $fn$;
CREATE FUNCTION public.custodial_original_inventory_separation_review_v1(
 p_manager uuid,p_credential uuid,p_device text,p_signed_expires timestamptz,
 p_security_session uuid,p_password_version integer,p_security_hash text,p_csrf_hash text,p_inventory_request uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT custodial_recovery.review_original_inventory(p_manager,p_credential,p_device,p_signed_expires,
  p_security_session,p_password_version,p_security_hash,p_csrf_hash,p_inventory_request)
$fn$;
REVOKE ALL ON FUNCTION custodial_recovery.inventory_object_keys(jsonb,text[]),custodial_recovery.inventory_count(jsonb,bigint),
 custodial_recovery.inventory_completion_current(jsonb,text,jsonb),
 custodial_recovery.review_original_inventory(uuid,uuid,text,timestamptz,uuid,integer,text,text,uuid),
 public.custodial_original_inventory_separation_review_v1(uuid,uuid,text,timestamptz,uuid,integer,text,text,uuid)
 FROM PUBLIC,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
GRANT EXECUTE ON FUNCTION public.custodial_original_inventory_separation_review_v1(uuid,uuid,text,timestamptz,uuid,integer,text,text,uuid)
 TO service_role;
COMMIT;
