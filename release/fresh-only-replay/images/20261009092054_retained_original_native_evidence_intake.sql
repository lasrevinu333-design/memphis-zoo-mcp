-- Source-only forward251; no application activation, acceptance, ACK or reuse.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE retained_evidence_inventory_before ON COMMIT DROP AS SELECT * FROM public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE retained_evidence_surface_before ON COMMIT DROP AS
 SELECT p.proacl acl,p.proowner owner,pg_get_functiondef(p.oid) definition FROM pg_proc p
 WHERE p.oid='public.custodial_release_canary_authority_surface()'::regprocedure;
DO $predecessor$ DECLARE body text;saved public.custodial_release_authority_restore_inventory%rowtype;BEGIN
 SELECT definition INTO STRICT body FROM retained_evidence_surface_before;
 IF public.static_weekly_digest_text(body) IS DISTINCT FROM '23b5359b2f39198d0ae90ff717a568e26e3c8e2b6aadf068caffb1f27a4dcdbb'
  OR (length(body)-length(replace(body,'  values','')))/length('  values')<>1 THEN
  RAISE EXCEPTION 'Retained evidence exact source250 canary predecessor changed';END IF;
 SELECT * INTO STRICT saved FROM retained_evidence_inventory_before WHERE object_kind='function'
  AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure;
 IF saved.definition_sql IS DISTINCT FROM body OR saved.definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(body)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A') THEN
  RAISE EXCEPTION 'Retained evidence captured predecessor/ALWAYS boundary changed';END IF;
 IF to_regclass('public.custodial_native_retained_evidence') IS NOT NULL
  OR to_regclass('public.custodial_native_retained_evidence_requests') IS NOT NULL THEN
  RAISE EXCEPTION 'Retained evidence source relations already exist';END IF;
END $predecessor$;

create table public.custodial_native_retained_evidence (
 operation_id uuid primary key,
 separation_id uuid not null references public.custodial_employee_separation_fences(separation_id),
 generation_id uuid not null references public.employee_native_push_generations(generation_id),
 device_id uuid not null references public.devices(id),
 credential_id uuid not null references public.device_auth_credentials(credential_id),
 employee_id uuid not null references public.employees(id),
 canonical_device_id text not null check(canonical_device_id ~ '^KIOSK_(0[2-9]|10)$'),
 assignment_epoch bigint not null check(assignment_epoch>0),
 authority_revision bigint not null check(authority_revision>0),
 cutoff_at timestamptz not null check(isfinite(cutoff_at)),
 wire_bytes bytea not null check(octet_length(wire_bytes) between 1 and 262144),
 wire_sha256 text not null check(wire_sha256 ~ '^[0-9a-f]{64}$'),
 verified_binding jsonb not null check(jsonb_typeof(verified_binding)='object'),
 original_context jsonb not null check(jsonb_typeof(original_context)='object'),
 original_generation jsonb not null check(jsonb_typeof(original_generation)='object'),
 retained_at timestamptz not null default clock_timestamp() check(isfinite(retained_at)),
 constraint custodial_native_retained_evidence_wire_digest check(wire_sha256=encode(extensions.digest(wire_bytes,'sha256'),'hex')),
 unique(separation_id,generation_id,credential_id,wire_sha256)
);
create table public.custodial_native_retained_evidence_requests (
 native_request_id uuid primary key,
 operation_id uuid not null references public.custodial_native_retained_evidence(operation_id),
 attestation_digest text not null check(attestation_digest ~ '^[0-9a-f]{64}$'),
 request_bytes bytea not null check(octet_length(request_bytes) between 1 and 393216),
 request_sha256 text not null check(request_sha256 ~ '^[0-9a-f]{64}$'),
 received_at timestamptz not null default clock_timestamp() check(isfinite(received_at)),
 constraint custodial_native_retained_request_digest check(request_sha256=encode(extensions.digest(request_bytes,'sha256'),'hex'))
);
alter table public.custodial_native_retained_evidence enable row level security;
alter table public.custodial_native_retained_evidence force row level security;
alter table public.custodial_native_retained_evidence_requests enable row level security;
alter table public.custodial_native_retained_evidence_requests force row level security;
revoke all on public.custodial_native_retained_evidence,public.custodial_native_retained_evidence_requests
 from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

create function public.custodial_v15_reject_retained_evidence_mutation()
returns trigger language plpgsql set search_path='' as $function$
begin raise exception using errcode='42501',message='retained original native evidence is immutable';end
$function$;
revoke all on function public.custodial_v15_reject_retained_evidence_mutation()
 from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
create trigger trg_native_retained_evidence_immutable before update or delete on public.custodial_native_retained_evidence
 for each row execute function public.custodial_v15_reject_retained_evidence_mutation();
create trigger trg_native_retained_evidence_no_truncate before truncate on public.custodial_native_retained_evidence
 for each statement execute function public.custodial_v15_reject_retained_evidence_mutation();
create trigger trg_native_retained_requests_immutable before update or delete on public.custodial_native_retained_evidence_requests
 for each row execute function public.custodial_v15_reject_retained_evidence_mutation();
create trigger trg_native_retained_requests_no_truncate before truncate on public.custodial_native_retained_evidence_requests
 for each statement execute function public.custodial_v15_reject_retained_evidence_mutation();
alter table public.custodial_native_retained_evidence enable always trigger trg_native_retained_evidence_immutable;
alter table public.custodial_native_retained_evidence enable always trigger trg_native_retained_evidence_no_truncate;
alter table public.custodial_native_retained_evidence_requests enable always trigger trg_native_retained_requests_immutable;
alter table public.custodial_native_retained_evidence_requests enable always trigger trg_native_retained_requests_no_truncate;

-- json (not jsonb) preserves duplicate keys and number spelling for validation.
create function public.custodial_v15_assert_native_json(v json,depth integer default 0)
returns integer language plpgsql immutable set search_path='' as $function$
declare row record;n integer:=1;kind text:=pg_catalog.json_typeof(v);raw text;
begin
 if v is null or depth<0 or depth>24 then raise exception using errcode='22023',message='native JSON limits';end if;
 if kind='object' then
  if (select count(*) from pg_catalog.json_each(v))<>(select count(distinct key collate "C") from pg_catalog.json_each(v)) then
   raise exception using errcode='22023',message='duplicate native JSON key';end if;
  for row in select value from pg_catalog.json_each(v) loop n:=n+public.custodial_v15_assert_native_json(row.value,depth+1);if n>32768 then raise exception using errcode='22023',message='native JSON values limit';end if;end loop;
 elsif kind='array' then
  for row in select value from pg_catalog.json_array_elements(v) loop n:=n+public.custodial_v15_assert_native_json(row.value,depth+1);if n>32768 then raise exception using errcode='22023',message='native JSON values limit';end if;end loop;
 elsif kind='number' then
  raw:=v::text;if raw !~ '^-?(0|[1-9][0-9]*)$' or raw='-0' or abs(raw::numeric)>9007199254740991 then raise exception using errcode='22023',message='native integer required';end if;
 end if;return n;
end $function$;
revoke all on function public.custodial_v15_assert_native_json(json,integer)
 from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

create function public.custodial_v15_retained_evidence_receipt(r public.custodial_native_retained_evidence)
returns jsonb language plpgsql immutable set search_path='' as $function$
declare body jsonb;
begin
 body:=pg_catalog.jsonb_build_object('schema','custodial.retained-original-native-evidence-receipt.v1',
  'status','RETAINED_ONLY_PENDING_RECONCILIATION','operation_id',r.operation_id,'separation_id',r.separation_id,
  'generation_id',r.generation_id,'device_id',r.device_id,'canonical_device_id',r.canonical_device_id,
  'credential_id',r.credential_id,'employee_id',r.employee_id,'assignment_epoch',r.assignment_epoch,
  'authority_revision',r.authority_revision,'cutoff_at',pg_catalog.to_char(r.cutoff_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'wire_sha256',r.wire_sha256,'wire_bytes',pg_catalog.octet_length(r.wire_bytes),
  'manifest_sha256',r.verified_binding->>'manifest_sha256','raw_snapshot_sha256',r.verified_binding->>'raw_snapshot_sha256',
  'record_count',r.verified_binding->'record_count','retained_at',pg_catalog.to_char(r.retained_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'payload_coverage','MANIFEST_AND_RECORD_DIGESTS_ONLY','record_values_retained',false,
  'native_semantic_inventory_state','UNKNOWN','browser_inventory_state','UNKNOWN',
  'inventory_acknowledged',false,'automatic_acceptance',false,'work_accepted',false,'new_work_allowed',false,'phone_released',false);
 return body||pg_catalog.jsonb_build_object('receipt_sha256',public.static_weekly_digest_jsonb(body));
end $function$;
revoke all on function public.custodial_v15_retained_evidence_receipt(public.custodial_native_retained_evidence)
 from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

create function public.custodial_v15_retain_original_native_evidence(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_native_request uuid,p_attestation_digest text,p_request_base64 text,p_binding jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare c public.device_auth_credentials%rowtype;f public.custodial_employee_separation_fences%rowtype;
 context jsonb;generation jsonb;frame jsonb;wire jsonb;body jsonb;raw json;
 request_bytes bytea;wire_bytes bytea;wire_digest text;request_digest text;
 prior public.custodial_native_retained_evidence%rowtype;attempt public.custodial_native_retained_evidence_requests%rowtype;replayed boolean:=false;
 keys text[];k text;item json;prev text:='';records_text text:='[';principal_text text;principal_schema text;entry record;
 required constant text[]:=array['automatic_acceptance','browser_inventory_state','credential_id','generation_activated_at','generation_id','inventory_acknowledged','manifest_sha256','native_semantic_inventory_state','new_work_allowed','phone_released','principal_digest','raw_snapshot_sha256','record_count','schema','separation_id','verification'];
begin
 if p_operation is null or p_device is null or p_credential is null or p_generation is null or p_native_request is null
  or p_credential_hash is null or p_credential_hash !~ '^[0-9a-f]{64}$' or p_credential_key_id is null or p_credential_key_id !~ '^[0-9a-f]{64}$'
  or p_attestation_digest is null or p_attestation_digest !~ '^[0-9a-f]{64}$' or p_request_base64 is null
  or length(p_request_base64)>524288 or p_request_base64 !~ '^[A-Za-z0-9+/]+={0,2}$'
  or pg_catalog.jsonb_typeof(p_binding) is distinct from 'object' then raise exception using errcode='22023',message='exact native retention request required';end if;
 select array_agg(key order by key collate "C") into keys from pg_catalog.jsonb_object_keys(p_binding) key;
 foreach k in array array['schema','verification','credential_id','generation_id','generation_activated_at','separation_id','principal_digest','manifest_sha256','raw_snapshot_sha256','native_semantic_inventory_state','browser_inventory_state'] loop
  if pg_catalog.jsonb_typeof(p_binding->k) is distinct from 'string' then raise exception using errcode='22023',message='literal binding strings required';end if;
 end loop;
 if keys is distinct from required or p_binding->>'schema' is distinct from 'custodial.native-protected-generation-raw-binding.v1'
  or p_binding->>'verification' is distinct from 'MATCHED_PRE_CUTOFF_GENERATION_RAW_BINDING_RETENTION_ONLY'
  or p_binding->>'native_semantic_inventory_state' is distinct from 'UNKNOWN' or p_binding->>'browser_inventory_state' is distinct from 'UNKNOWN'
  or p_binding->'inventory_acknowledged' is distinct from 'false'::jsonb or p_binding->'automatic_acceptance' is distinct from 'false'::jsonb
  or p_binding->'new_work_allowed' is distinct from 'false'::jsonb or p_binding->'phone_released' is distinct from 'false'::jsonb
  or p_binding->>'credential_id' is distinct from p_credential::text or p_binding->>'generation_id' is distinct from p_generation::text
  or pg_catalog.jsonb_typeof(p_binding->'record_count') is distinct from 'number'
  or p_binding->>'record_count' !~ '^(0|[1-9][0-9]*)$' or (p_binding->>'record_count')::numeric>4096
  or p_binding->>'manifest_sha256' !~ '^[0-9a-f]{64}$' or p_binding->>'raw_snapshot_sha256' !~ '^[0-9a-f]{64}$'
  or p_binding->>'principal_digest' !~ '^[0-9a-f]{64}$' then raise exception using errcode='22023',message='retention-only verified binding required';end if;
 request_bytes:=pg_catalog.decode(p_request_base64,'base64');
 if pg_catalog.octet_length(request_bytes) not between 1 and 393216 or pg_catalog.replace(pg_catalog.encode(request_bytes,'base64'),E'\n','')<>p_request_base64 then raise exception using errcode='22023',message='canonical request bytes required';end if;
 raw:=pg_catalog.convert_from(request_bytes,'UTF8')::json;perform public.custodial_v15_assert_native_json(raw);frame:=raw::jsonb;
 select array_agg(key order by key collate "C") into keys from pg_catalog.jsonb_object_keys(frame) key;
 if keys is distinct from array['generation_id','operation_id','schema','signed_wire_base64']::text[]
  or frame->>'schema' is distinct from 'custodial.original-native-evidence-intake.v1'
  or frame->>'operation_id' is distinct from p_operation::text or frame->>'generation_id' is distinct from p_generation::text
  or pg_catalog.jsonb_typeof(frame->'signed_wire_base64') is distinct from 'string' or frame->>'signed_wire_base64' !~ '^[A-Za-z0-9+/]+={0,2}$' then raise exception using errcode='22023',message='exact intake envelope required';end if;
 wire_bytes:=pg_catalog.decode(frame->>'signed_wire_base64','base64');
 if pg_catalog.octet_length(wire_bytes) not between 1 and 262144 or pg_catalog.replace(pg_catalog.encode(wire_bytes,'base64'),E'\n','')<>frame->>'signed_wire_base64' then raise exception using errcode='22023',message='canonical original wire bytes required';end if;
 raw:=pg_catalog.convert_from(wire_bytes,'UTF8')::json;perform public.custodial_v15_assert_native_json(raw);wire:=raw::jsonb;
 select array_agg(key order by key collate "C") into keys from pg_catalog.jsonb_object_keys(wire) key;
 if keys is distinct from array['attestation','attestation_version','manifest_body','manifest_sha256']::text[]
  or wire->>'attestation_version' is distinct from 'custodial-native-protected-snapshot.v1'
  or pg_catalog.jsonb_typeof(wire->'manifest_body') is distinct from 'string' or pg_catalog.octet_length(pg_catalog.convert_to(wire->>'manifest_body','UTF8'))>131072
  or pg_catalog.jsonb_typeof(wire->'attestation') is distinct from 'string' or wire->>'attestation' !~ '^[0-9a-f]{64}$' or wire->>'manifest_sha256' is distinct from p_binding->>'manifest_sha256'
  or pg_catalog.encode(extensions.digest(pg_catalog.convert_to(wire->>'manifest_body','UTF8'),'sha256'),'hex') is distinct from p_binding->>'manifest_sha256' then raise exception using errcode='22023',message='original manifest digest required';end if;
 raw:=(wire->>'manifest_body')::json;perform public.custodial_v15_assert_native_json(raw);body:=raw::jsonb;
 select array_agg(key order by key collate "C") into keys from pg_catalog.jsonb_object_keys(body) key;
 if keys is distinct from array['browser_inventory_state','native_semantic_inventory_state','new_work_allowed','original_principal','phone_released','raw_snapshot_sha256','record_count','records','schema','separation_context']::text[]
  or pg_catalog.jsonb_typeof(body->'records') is distinct from 'array' or pg_catalog.jsonb_array_length(body->'records')<>(p_binding->>'record_count')::integer
  or pg_catalog.jsonb_typeof(body->'original_principal') is distinct from 'object' then raise exception using errcode='22023',message='exact original manifest structure required';end if;
 if body->>'schema' is distinct from 'custodial.native-protected-work-snapshot.v1' or body->>'raw_snapshot_sha256' is distinct from p_binding->>'raw_snapshot_sha256'
  or body->'record_count' is distinct from p_binding->'record_count' or body->>'native_semantic_inventory_state' is distinct from 'UNKNOWN'
  or body->>'browser_inventory_state' is distinct from 'UNKNOWN' or body->'new_work_allowed' is distinct from 'false'::jsonb
  or body->'phone_released' is distinct from 'false'::jsonb then raise exception using errcode='22023',message='manifest retention fields required';end if;
 -- Same ASCII key/type/hash array serialization as the unchanged native/JS
 -- verifier. Store original wire bytes; this recomputation is metadata only.
 for item in select value from pg_catalog.json_array_elements(raw->'records') loop
  if pg_catalog.json_typeof(item) is distinct from 'array' or pg_catalog.json_array_length(item)<>3
   or pg_catalog.json_typeof(item->0) is distinct from 'string' or pg_catalog.json_typeof(item->1) is distinct from 'string' or pg_catalog.json_typeof(item->2) is distinct from 'string'
   or length(item->>0) not between 4 and 4096 or length(item->>0)%4<>0 or item->>0 !~ '^[0-9a-f]+$'
   or (item->>0) collate "C"<=prev collate "C" or (item->>1) not in ('string','int32','int64','boolean','float32','string-set') or (item->>2) !~ '^[0-9a-f]{64}$'
   then raise exception using errcode='22023',message='closed ordered native record digest rows required';end if;
  if records_text<>'[' then records_text:=records_text||',';end if;
  records_text:=records_text||'['||pg_catalog.to_json(item->>0)::text||','||pg_catalog.to_json(item->>1)::text||','||pg_catalog.to_json(item->>2)::text||']';prev:=item->>0;
 end loop;records_text:=records_text||']';
 if pg_catalog.encode(extensions.digest(pg_catalog.convert_to('["custodial.native-protected-work-snapshot.v1",'||pg_catalog.to_json(records_text)::text||']','UTF8'),'sha256'),'hex') is distinct from p_binding->>'raw_snapshot_sha256' then raise exception using errcode='22023',message='actual native record digest required';end if;
 -- Full principal digest is checked again against the original generation.
 -- Values are strings except the exact integer epoch; named keys are ASCII.
 principal_schema:=body#>>'{original_principal,schema_version}';
 select array_agg(key order by key collate "C") into keys from pg_catalog.jsonb_object_keys(body->'original_principal') key;
 if principal_schema='custodial-protected-principal.v1' then
  if keys is distinct from array['assignment_epoch','credential_id','credential_operation_id','device_id','employee_id','enrolled_at','installation_seal','schema_version']::text[] then raise exception using errcode='22023',message='exact original principal required';end if;
 elsif principal_schema='custodial-protected-principal.v2' then
  if keys is distinct from array['activation_operation_id','activation_receipt_sha256','assignment_epoch','credential_id','device_id','employee_id','enrolled_at','installation_binding_sha256','installation_seal','legacy_binding_id','legacy_binding_kind','schema_version']::text[] then raise exception using errcode='22023',message='exact original principal required';end if;
 else raise exception using errcode='22023',message='original principal schema required';end if;
 principal_text:='["custodial.native-provider-principal.v1"';
 for entry in select key,value from pg_catalog.jsonb_each(body->'original_principal') order by key collate "C" loop
  if entry.key='assignment_epoch' then
   if pg_catalog.jsonb_typeof(entry.value) is distinct from 'number' or entry.value::text !~ '^[1-9][0-9]*$' then raise exception using errcode='22023',message='original principal epoch required';end if;
  elsif pg_catalog.jsonb_typeof(entry.value) is distinct from 'string' then raise exception using errcode='22023',message='original principal text required';end if;
  principal_text:=principal_text||',['||pg_catalog.to_json(entry.key)::text||','||entry.value::text||']';
 end loop;principal_text:=principal_text||']';
 if pg_catalog.encode(extensions.digest(pg_catalog.convert_to(principal_text,'UTF8'),'sha256'),'hex') is distinct from p_binding->>'principal_digest' then raise exception using errcode='22023',message='full original principal digest required';end if;
 perform public.custodial_begin_application_mutation();
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('memphis-static-weekly-authority',0));
 select * into c from public.device_auth_credentials where credential_id=p_credential and device_id=p_device for share;
 if not found or c.revoked_at is not null or c.confirmed_at is null or c.token_hash is distinct from p_credential_hash
  or c.metadata_json is not null and pg_catalog.jsonb_typeof(c.metadata_json) not in ('object','null')
  or pg_catalog.jsonb_typeof(c.metadata_json)='object' and c.metadata_json ? 'credential_secret_key_id'
   and (pg_catalog.jsonb_typeof(c.metadata_json->'credential_secret_key_id') is distinct from 'string' or c.metadata_json->>'credential_secret_key_id' is distinct from p_credential_key_id)
 then raise exception using errcode='42501',message='original credential retention authority required';end if;
 context:=public.custodial_v13_read_separation_context(p_device,p_credential);
 if context is null or context->>'separation_id' is distinct from p_binding->>'separation_id' then raise exception using errcode='42501',message='original separation scope required';end if;
 if body#>>'{original_principal,device_id}' is distinct from context->>'canonical_device_id' or body#>>'{original_principal,employee_id}' is distinct from context->>'employee_id'
  or body#>>'{original_principal,credential_id}' is distinct from context->>'credential_id' or body#>'{original_principal,assignment_epoch}' is distinct from context->'assignment_epoch' then raise exception using errcode='42501',message='original principal tuple required';end if;
 select * into strict f from public.custodial_employee_separation_fences where separation_id=(context->>'separation_id')::uuid for update;
 if f.state<>'PENDING_RECONCILIATION' then raise exception using errcode='42501',message='separation no longer pending';end if;
 generation:=public.custodial_v14_read_separation_generation(p_device,p_credential,f.separation_id,p_generation,p_binding->>'principal_digest');
 if generation is null or generation->>'activated_at' is distinct from p_binding->>'generation_activated_at' then raise exception using errcode='42501',message='original generation retention scope required';end if;
 wire_digest:=pg_catalog.encode(extensions.digest(wire_bytes,'sha256'),'hex');request_digest:=pg_catalog.encode(extensions.digest(request_bytes,'sha256'),'hex');
 select * into prior from public.custodial_native_retained_evidence where operation_id=p_operation;
 if found then
  if prior.device_id<>p_device or prior.credential_id<>p_credential or prior.generation_id<>p_generation or prior.separation_id<>f.separation_id
   or prior.wire_bytes is distinct from wire_bytes or prior.wire_sha256<>wire_digest or prior.verified_binding is distinct from p_binding
   or body->'separation_context' is distinct from prior.original_context then raise exception using errcode='23505',message='retained operation identity conflict';end if;
  replayed:=true;
 else
  if body->'separation_context' is distinct from context then raise exception using errcode='22023',message='exact original context required before initial retention';end if;
  insert into public.custodial_native_retained_evidence(operation_id,separation_id,generation_id,device_id,credential_id,employee_id,canonical_device_id,assignment_epoch,authority_revision,cutoff_at,wire_bytes,wire_sha256,verified_binding,original_context,original_generation)
   values(p_operation,f.separation_id,p_generation,p_device,p_credential,(context->>'employee_id')::uuid,context->>'canonical_device_id',(context->>'assignment_epoch')::bigint,f.authority_revision,f.separated_at,wire_bytes,wire_digest,p_binding,context,generation) returning * into prior;
 end if;
 select * into attempt from public.custodial_native_retained_evidence_requests where native_request_id=p_native_request;
 if found then
  if attempt.operation_id<>p_operation or attempt.attestation_digest<>p_attestation_digest or attempt.request_bytes is distinct from request_bytes or attempt.request_sha256<>request_digest then raise exception using errcode='23505',message='native retention request identity conflict';end if;
 else
  insert into public.custodial_native_retained_evidence_requests(native_request_id,operation_id,attestation_digest,request_bytes,request_sha256) values(p_native_request,p_operation,p_attestation_digest,request_bytes,request_digest);
 end if;
 return pg_catalog.jsonb_build_object('receipt',public.custodial_v15_retained_evidence_receipt(prior),'replayed',replayed,'native_request_id',p_native_request,'request_body_sha256',request_digest);
end $function$;

create function public.custodial_v15_read_retained_native_evidence(p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_native_request uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare c public.device_auth_credentials%rowtype;r public.custodial_native_retained_evidence%rowtype;attempt public.custodial_native_retained_evidence_requests%rowtype;result jsonb;
begin
 if p_operation is null or p_device is null or p_credential is null or p_credential_hash is null or p_credential_hash !~ '^[0-9a-f]{64}$'
  or p_credential_key_id is null or p_credential_key_id !~ '^[0-9a-f]{64}$' then raise exception using errcode='22023',message='exact retained read identity required';end if;
 select * into c from public.device_auth_credentials where credential_id=p_credential and device_id=p_device;
 if not found or c.revoked_at is not null or c.confirmed_at is null or c.token_hash is distinct from p_credential_hash
  or c.metadata_json is not null and pg_catalog.jsonb_typeof(c.metadata_json) not in ('object','null')
  or pg_catalog.jsonb_typeof(c.metadata_json)='object' and c.metadata_json ? 'credential_secret_key_id'
   and (pg_catalog.jsonb_typeof(c.metadata_json->'credential_secret_key_id') is distinct from 'string' or c.metadata_json->>'credential_secret_key_id' is distinct from p_credential_key_id)
 then raise exception using errcode='42501',message='retained read credential required';end if;
 select * into r from public.custodial_native_retained_evidence where operation_id=p_operation and device_id=p_device and credential_id=p_credential;
 if not found then return null;end if;
 if r.wire_sha256 is distinct from pg_catalog.encode(extensions.digest(r.wire_bytes,'sha256'),'hex') then raise exception using errcode='23514',message='retained wire drift';end if;
 result:=pg_catalog.jsonb_build_object('receipt',public.custodial_v15_retained_evidence_receipt(r),'stored_wire_sha256',r.wire_sha256,'stored_wire_bytes',pg_catalog.octet_length(r.wire_bytes));
 if p_native_request is not null then
  select * into attempt from public.custodial_native_retained_evidence_requests where native_request_id=p_native_request and operation_id=p_operation;
  result:=result||pg_catalog.jsonb_build_object('request',case when found then pg_catalog.jsonb_build_object('operation_id',attempt.operation_id,'native_request_id',attempt.native_request_id,'attestation_digest',attempt.attestation_digest,'request_body_sha256',attempt.request_sha256) else null end);
 end if;return result;
end $function$;
revoke all on function public.custodial_v15_retain_original_native_evidence(uuid,uuid,uuid,text,text,uuid,uuid,text,text,jsonb)
 from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
revoke all on function public.custodial_v15_read_retained_native_evidence(uuid,uuid,uuid,text,text,uuid)
 from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
grant execute on function public.custodial_v15_retain_original_native_evidence(uuid,uuid,uuid,text,text,uuid,uuid,text,text,jsonb) to service_role;
grant execute on function public.custodial_v15_read_retained_native_evidence(uuid,uuid,uuid,text,text,uuid) to service_role;

-- Complete, explicitly scoped ledger recovery objects. Relation/function names
-- are finite source declarations, not a broad catalog/ACL recapture.
CREATE TEMP TABLE retained_evidence_objects ON COMMIT DROP AS
 WITH funcs AS(SELECT p.oid FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN(
  'custodial_v15_reject_retained_evidence_mutation','custodial_v15_assert_native_json','custodial_v15_retained_evidence_receipt',
  'custodial_v15_retain_original_native_evidence','custodial_v15_read_retained_native_evidence')),
 objects AS(
 SELECT 100000 bucket,'function'::text kind,'public.'||oid::regprocedure::text identity,pg_get_functiondef(oid) definition FROM funcs
 UNION ALL SELECT 900000,'grant','public.'||oid::regprocedure::text,public.custodial_release_authority_current_grant_definition('public.'||oid::regprocedure::text) FROM funcs
 UNION ALL SELECT x.bucket,x.kind,x.identity,x.definition FROM unnest(array['public.custodial_native_retained_evidence','public.custodial_native_retained_evidence_requests']) rel CROSS JOIN LATERAL(
  SELECT 1000 bucket,'relation'::text kind,rel identity,public.custodial_release_authority_current_relation_definition(rel) definition
  UNION ALL SELECT 200000,'column',rel||':'||attname,public.custodial_release_authority_current_column_definition(rel||':'||attname)
   FROM pg_attribute WHERE attrelid=rel::regclass AND attnum>0 AND NOT attisdropped
  UNION ALL SELECT 300000,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)
  UNION ALL SELECT 400000,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)
  UNION ALL SELECT 500000,'constraint',rel||':'||conname,public.custodial_release_authority_current_constraint_definition(rel||':'||conname)
   FROM pg_constraint WHERE conrelid=rel::regclass
  UNION ALL SELECT 600000,'index',indexrelid::regclass::text,public.custodial_release_authority_current_index_definition(indexrelid::regclass::text)
   FROM pg_index i WHERE indrelid=rel::regclass AND NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conindid=i.indexrelid)
  UNION ALL SELECT 700000,'trigger',rel||'.'||tgname,'drop trigger if exists '||quote_ident(tgname)||' on '||rel||'; '
   ||pg_get_triggerdef(oid,true)||'; alter table '||rel||CASE WHEN tgenabled='A' THEN ' enable always trigger ' ELSE ' enable trigger ' END||quote_ident(tgname)||';'
   FROM pg_trigger WHERE tgrelid=rel::regclass AND NOT tgisinternal
  UNION ALL SELECT 800000,'policy',rel||':'||polname,public.custodial_release_authority_current_policy_definition(rel||':'||polname)
   FROM pg_policy WHERE polrelid=rel::regclass
  UNION ALL SELECT 900000,'grant',rel,public.custodial_release_authority_current_grant_definition(rel)) x)
 SELECT * FROM objects;
DO $objects$ BEGIN
 IF (SELECT count(*) FROM retained_evidence_objects WHERE kind='function')<>5
  OR (SELECT count(*) FROM retained_evidence_objects WHERE kind='relation')<>2
  OR (SELECT count(*) FROM retained_evidence_objects WHERE kind='column')<>22
  OR (SELECT count(*) FROM retained_evidence_objects WHERE kind='trigger')<>6
  OR (SELECT count(*) FROM pg_trigger WHERE tgrelid IN('public.custodial_native_retained_evidence'::regclass,'public.custodial_native_retained_evidence_requests'::regclass)
   AND tgname='custodial_disaster_restore_mutation_fence' AND tgfoid='custodial_dr.guard_application_mutation()'::regprocedure AND tgenabled='O')<>2
  OR (SELECT count(*) FROM pg_trigger WHERE tgrelid IN('public.custodial_native_retained_evidence'::regclass,'public.custodial_native_retained_evidence_requests'::regclass)
   AND tgname IN('trg_native_retained_evidence_immutable','trg_native_retained_evidence_no_truncate','trg_native_retained_requests_immutable','trg_native_retained_requests_no_truncate') AND tgenabled='A')<>4
  OR EXISTS(SELECT 1 FROM retained_evidence_objects WHERE definition IS NULL)
  OR EXISTS(SELECT kind,identity FROM retained_evidence_objects GROUP BY kind,identity HAVING count(*)<>1)
  OR EXISTS(SELECT 1 FROM retained_evidence_inventory_before old JOIN retained_evidence_objects x
   ON x.kind=old.object_kind AND x.identity=old.object_identity) THEN
  RAISE EXCEPTION 'Retained evidence finite object declaration changed';END IF;
END $objects$;
DO $surface$ DECLARE original text;patched text;entries text;BEGIN
 SELECT definition INTO STRICT original FROM retained_evidence_surface_before;
 SELECT string_agg('('||quote_literal(kind)||','||quote_literal(identity)||','||quote_literal('original retained manifest/digest evidence only; no work, ACK or reuse')||'),',E'\n' ORDER BY kind,identity)
  INTO entries FROM retained_evidence_objects;
 patched:=replace(original,'  values','  values'||E'\n'||entries);EXECUTE patched;
 IF pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure) IS DISTINCT FROM patched
  OR (SELECT proacl FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure)
   IS DISTINCT FROM (SELECT acl FROM retained_evidence_surface_before)
  OR (SELECT proowner FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure)
   IS DISTINCT FROM (SELECT owner FROM retained_evidence_surface_before) THEN
  RAISE EXCEPTION 'Retained evidence canary owner/ACL/body changed outside exact extension';END IF;
END $surface$;
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery$ DECLARE obj record;next_order integer;changed integer;BEGIN
 UPDATE public.custodial_release_authority_restore_inventory SET
  definition_sql=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure),
  definition_sha256=public.static_weekly_digest_text(pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure)),captured_at=statement_timestamp()
  WHERE object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
   AND definition_sql=(SELECT definition FROM retained_evidence_surface_before);
 GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'Retained evidence canary inventory predecessor changed';END IF;
 FOR obj IN SELECT * FROM retained_evidence_objects ORDER BY bucket,identity LOOP
  SELECT n INTO next_order FROM generate_series(obj.bucket+1,CASE WHEN obj.bucket=1000 THEN 99998 ELSE obj.bucket+99998 END) n
   WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=n) ORDER BY n LIMIT 1;
  IF next_order IS NULL THEN RAISE EXCEPTION 'Retained evidence recovery order exhausted';END IF;
  INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   VALUES(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
 END LOOP;
END $recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $scope$ BEGIN
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>
  (SELECT count(*) FROM retained_evidence_inventory_before)+(SELECT count(*) FROM retained_evidence_objects)
  OR EXISTS(SELECT old.* FROM retained_evidence_inventory_before old WHERE NOT(object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)
   EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT now.* FROM public.custodial_release_authority_restore_inventory now WHERE NOT(object_kind='function' AND object_identity LIKE '%(%'
   AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure)
   AND NOT EXISTS(SELECT 1 FROM retained_evidence_objects x WHERE x.kind=now.object_kind AND x.identity=now.object_identity)
   EXCEPT SELECT * FROM retained_evidence_inventory_before) THEN
  RAISE EXCEPTION 'Unrelated retained evidence recovery scope changed';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
  OR EXISTS(SELECT 1 FROM retained_evidence_objects x JOIN public.custodial_release_authority_restore_inventory i
   ON x.kind=i.object_kind AND x.identity=i.object_identity WHERE i.definition_sql IS DISTINCT FROM x.definition
    OR i.definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(x.definition)) THEN
  RAISE EXCEPTION 'Retained evidence final ALWAYS guard or captured bytes changed';END IF;
END $scope$;
COMMIT;
