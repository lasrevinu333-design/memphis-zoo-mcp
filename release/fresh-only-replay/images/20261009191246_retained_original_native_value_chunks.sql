-- Source-only forward252; no HTTP/native activation, semantic ACK or reuse.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,extensions;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE retained_values_inventory_before ON COMMIT DROP AS SELECT * FROM public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE retained_values_functions_before ON COMMIT DROP AS
 SELECT p.oid,p.proname,p.proacl acl,p.proowner owner,pg_get_functiondef(p.oid) definition
 FROM pg_proc p WHERE p.oid IN('public.custodial_release_canary_authority_surface()'::regprocedure,
  'public.custodial_v15_retain_original_native_evidence(uuid,uuid,uuid,text,text,uuid,uuid,text,text,jsonb)'::regprocedure,
  'public.custodial_v15_read_retained_native_evidence(uuid,uuid,uuid,text,text,uuid)'::regprocedure);
DO $predecessor$ DECLARE obj record;BEGIN
 IF (SELECT count(*) FROM retained_values_inventory_before)<>6783
  OR (SELECT count(*) FROM retained_values_functions_before)<>3
  OR EXISTS(SELECT 1 FROM retained_values_functions_before f WHERE public.static_weekly_digest_text(f.definition) IS DISTINCT FROM
    CASE f.proname WHEN 'custodial_release_canary_authority_surface' THEN '3d2c465e0a979ce19d1dc6a2c8baeab5f36acb29afe7efdecdd8b991ef4e108d'
     WHEN 'custodial_v15_retain_original_native_evidence' THEN '2f74edabb7c90f6391cca442c5e1feacc3c9bb64484e40371a6577295883af7c'
     WHEN 'custodial_v15_read_retained_native_evidence' THEN '172076aa5caeddc9d351d64f8bbaacc88aa08b43d2e0a2b865247f7b2523a855' END)
  OR EXISTS(SELECT 1 FROM retained_values_functions_before f WHERE NOT EXISTS(SELECT 1 FROM retained_values_inventory_before i
    WHERE i.object_kind='function' AND i.object_identity LIKE '%(%' AND to_regprocedure(i.object_identity)=f.oid
     AND i.definition_sql=f.definition AND i.definition_sha256=public.static_weekly_digest_text(f.definition)))
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A') THEN
  RAISE EXCEPTION 'Retained values exact source251 predecessor/ALWAYS inventory changed';END IF;
 IF EXISTS(SELECT 1 FROM unnest(array['public.custodial_private_retained_record_values','public.custodial_private_retained_value_requests',
   'public.custodial_private_retained_value_chunks','public.custodial_private_retained_chunk_requests']) rel WHERE to_regclass(rel) IS NOT NULL)
  OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
   'custodial_private_assert_original_record_values','custodial_private_retain_original_record_values','custodial_private_read_original_record_values',
   'custodial_private_parse_original_value_chunk','custodial_private_read_original_value_chunk','custodial_private_retain_original_value_chunk')) THEN
  RAISE EXCEPTION 'Unadmitted retained-value survivors cannot be adopted';END IF;
END $predecessor$;

-- UNINTEGRATED OWNER-PRIVATE DRAFT, not a numbered migration or runtime grant.
-- Requires the exact existing retained-evidence/request ledger. No HTTP/native
-- value export, decryption, semantic ACK/finalizer, key deletion or reuse.
create table public.custodial_private_retained_record_values (
 operation_id uuid primary key references public.custodial_native_retained_evidence(operation_id),
 native_request_id uuid not null references public.custodial_native_retained_evidence_requests(native_request_id),
 parent_wire_sha256 text not null check(parent_wire_sha256 ~ '^[0-9a-f]{64}$'),
 values_bytes bytea not null check(octet_length(values_bytes) between 1 and 41943040),
 values_sha256 text not null check(values_sha256 ~ '^[0-9a-f]{64}$'),
 record_count integer not null check(record_count between 0 and 4096),
 retained_at timestamptz not null default clock_timestamp() check(isfinite(retained_at)),
 check(values_sha256=encode(extensions.digest(values_bytes,'sha256'),'hex'))
);
alter table public.custodial_private_retained_record_values enable row level security;
alter table public.custodial_private_retained_record_values force row level security;
revoke all on public.custodial_private_retained_record_values from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
create trigger trg_private_values_immutable before update or delete on public.custodial_private_retained_record_values for each row execute function public.custodial_v15_reject_retained_evidence_mutation();
create trigger trg_private_values_no_truncate before truncate on public.custodial_private_retained_record_values for each statement execute function public.custodial_v15_reject_retained_evidence_mutation();
alter table public.custodial_private_retained_record_values enable always trigger trg_private_values_immutable;
alter table public.custodial_private_retained_record_values enable always trigger trg_private_values_no_truncate;
create table public.custodial_private_retained_value_requests (
 native_request_id uuid primary key references public.custodial_native_retained_evidence_requests(native_request_id),
 operation_id uuid not null references public.custodial_private_retained_record_values(operation_id),
 values_sha256 text not null check(values_sha256 ~ '^[0-9a-f]{64}$'),
 received_at timestamptz not null default clock_timestamp() check(isfinite(received_at))
);
alter table public.custodial_private_retained_value_requests enable row level security;
alter table public.custodial_private_retained_value_requests force row level security;
revoke all on public.custodial_private_retained_value_requests from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
create trigger trg_private_value_requests_immutable before update or delete on public.custodial_private_retained_value_requests for each row execute function public.custodial_v15_reject_retained_evidence_mutation();
create trigger trg_private_value_requests_no_truncate before truncate on public.custodial_private_retained_value_requests for each statement execute function public.custodial_v15_reject_retained_evidence_mutation();
alter table public.custodial_private_retained_value_requests enable always trigger trg_private_value_requests_immutable;
alter table public.custodial_private_retained_value_requests enable always trigger trg_private_value_requests_no_truncate;

create function public.custodial_private_assert_original_record_values(p_operation uuid,p_values bytea)
returns integer language plpgsql security invoker set search_path='' as $function$
declare parent public.custodial_native_retained_evidence%rowtype;
 wire json;body json;payload json;record json;expected json;item json;kind text;value text;
 canon text:='{"schema":"custodial.retained-native-record-values.v1","records":[';
 rows_text text:='[';first_row boolean:=true;first_item boolean;prior_key text:='';prior_item text;
 count_records integer;index_record integer:=0;units bigint:=0;raw_value bytea;digest text;num numeric;keys text[];
begin
 if p_operation is null or p_values is null or pg_catalog.octet_length(p_values) not between 1 and 41943040 then raise exception using errcode='22023',message='bounded original values required';end if;
 select * into parent from public.custodial_native_retained_evidence where operation_id=p_operation;
 if not found then raise exception using errcode='42501',message='committed original evidence required';end if;
 if parent.wire_sha256 is distinct from pg_catalog.encode(extensions.digest(parent.wire_bytes,'sha256'),'hex') then raise exception using errcode='23514',message='original retained wire drift';end if;
 wire:=pg_catalog.convert_from(parent.wire_bytes,'UTF8')::json;
 body:=(wire->>'manifest_body')::json;
 if wire->>'manifest_sha256' is distinct from pg_catalog.encode(extensions.digest(pg_catalog.convert_to(wire->>'manifest_body','UTF8'),'sha256'),'hex')
  or wire->>'manifest_sha256' is distinct from parent.verified_binding->>'manifest_sha256'
  or body->>'raw_snapshot_sha256' is distinct from parent.verified_binding->>'raw_snapshot_sha256'
  or pg_catalog.json_typeof(body->'records') is distinct from 'array'
  then raise exception using errcode='23514',message='original manifest binding drift';end if;
 payload:=pg_catalog.convert_from(p_values,'UTF8')::json;
 select array_agg(key order by key collate "C") into keys from pg_catalog.json_each(payload);
 if keys is distinct from array['records','schema']::text[] or payload->>'schema' is distinct from 'custodial.retained-native-record-values.v1'
  or pg_catalog.json_typeof(payload->'records') is distinct from 'array' then raise exception using errcode='22023',message='closed canonical raw values required';end if;
 count_records:=pg_catalog.json_array_length(payload->'records');
 if count_records>4096 or count_records<>pg_catalog.json_array_length(body->'records')
  or count_records<>(parent.verified_binding->>'record_count')::integer or count_records<>(body->>'record_count')::integer
  then raise exception using errcode='22023',message='complete original record count required';end if;
 for record in select v from pg_catalog.json_array_elements(payload->'records') with ordinality as x(v,ord) order by ord loop
  expected:=body->'records'->index_record;
  if pg_catalog.json_typeof(record) is distinct from 'array' or pg_catalog.json_array_length(record)<>3
   or pg_catalog.json_typeof(record->0) is distinct from 'string' or pg_catalog.json_typeof(record->1) is distinct from 'string'
   or length(record->>0) not between 4 and 4096 or length(record->>0)%4<>0 or record->>0 !~ '^[0-9a-f]+$'
   or (record->>0) collate "C"<=prior_key collate "C" or record->>0 is distinct from expected->>0 or record->>1 is distinct from expected->>1
   then raise exception using errcode='22023',message='exact ordered original key and type required';end if;
  prior_key:=record->>0;units:=units+length(prior_key)/4;kind:=record->>1;raw_value:='\x'::bytea;
  if not first_row then canon:=canon||',';rows_text:=rows_text||',';end if;first_row:=false;
  canon:=canon||'['||pg_catalog.to_json(prior_key)::text||','||pg_catalog.to_json(kind)::text||',';
  if kind in ('string','int32','int64','float32') then
   if pg_catalog.json_typeof(record->2) is distinct from 'string' then raise exception using errcode='22023',message='literal raw value required';end if;
   value:=record->>2;canon:=canon||pg_catalog.to_json(value)::text;
   if kind='string' then
    if length(value)>2097152 or length(value)%4<>0 or value !~ '^([0-9a-f]{4})*$' then raise exception using errcode='22023',message='lossless bounded UTF16 value required';end if;
    units:=units+length(value)/4;raw_value:=pg_catalog.int4send(length(value)/4)||pg_catalog.decode(value,'hex');
   else
    if kind in ('int32','int64') then
     if length(value)>20 or value !~ '^(0|[1-9][0-9]*|-[1-9][0-9]*)$' then raise exception using errcode='22023',message='canonical integer text required';end if;
     num:=value::numeric;
     if (kind='int32' and (num< -2147483648 or num>2147483647)) or (kind='int64' and (num< -9223372036854775808::numeric or num>9223372036854775807::numeric)) then raise exception using errcode='22023',message='native integer bounds';end if;
    elsif kind='float32' then
     if value !~ '^[0-9a-f]{8}$' then raise exception using errcode='22023',message='raw float32 bits required';end if;
     value:=coalesce(nullif(pg_catalog.ltrim(value,'0'),''),'0');
    end if;
    raw_value:=pg_catalog.int4send(length(value))||pg_catalog.decode(pg_catalog.regexp_replace(pg_catalog.encode(pg_catalog.convert_to(value,'UTF8'),'hex'),'(..)','00\1','g'),'hex');
   end if;
  elsif kind='boolean' then
   if pg_catalog.json_typeof(record->2) is distinct from 'boolean' then raise exception using errcode='22023',message='native boolean required';end if;
   canon:=canon||(record->2)::text;raw_value:=pg_catalog.decode(case when (record->2)::text='true' then '01' else '00' end,'hex');
  elsif kind='string-set' then
   if pg_catalog.json_typeof(record->2) is distinct from 'array' or pg_catalog.json_array_length(record->2)>4096 then raise exception using errcode='22023',message='bounded original string set required';end if;
   canon:=canon||'[';first_item:=true;prior_item:=null;
   for item in select v from pg_catalog.json_array_elements(record->2) with ordinality as x(v,ord) order by ord loop
    value:=item#>>'{}';
    if pg_catalog.json_typeof(item) is distinct from 'string' or length(value)>2097152 or length(value)%4<>0 or value !~ '^([0-9a-f]{4})*$'
     or prior_item is not null and value collate "C"<=prior_item collate "C" then raise exception using errcode='22023',message='exact ordered lossless string set required';end if;
    if not first_item then canon:=canon||',';end if;first_item:=false;prior_item:=value;
    canon:=canon||pg_catalog.to_json(value)::text;units:=units+length(value)/4;
    raw_value:=raw_value||pg_catalog.int4send(length(value)/4)||pg_catalog.decode(value,'hex');
   end loop;canon:=canon||']';
  else raise exception using errcode='22023',message='closed native value type required';end if;
  if units>8388608 then raise exception using errcode='22023',message='native complete snapshot character limit';end if;
  digest:=pg_catalog.encode(extensions.digest(raw_value,'sha256'),'hex');
  if digest is distinct from expected->>2 then raise exception using errcode='22023',message='original raw value digest mismatch';end if;
  rows_text:=rows_text||'['||pg_catalog.to_json(prior_key)::text||','||pg_catalog.to_json(kind)::text||','||pg_catalog.to_json(digest)::text||']';
  canon:=canon||']';index_record:=index_record+1;
 end loop;canon:=canon||']}';rows_text:=rows_text||']';
 if pg_catalog.convert_to(canon,'UTF8') is distinct from p_values then raise exception using errcode='22023',message='exact canonical raw value bytes required';end if;
 if pg_catalog.encode(extensions.digest(pg_catalog.convert_to('["custodial.native-protected-work-snapshot.v1",'||pg_catalog.to_json(rows_text)::text||']','UTF8'),'sha256'),'hex') is distinct from body->>'raw_snapshot_sha256' then raise exception using errcode='23514',message='original record snapshot drift';end if;
 return count_records;
end $function$;
revoke all on function public.custodial_private_assert_original_record_values(uuid,bytea) from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

create function public.custodial_private_retain_original_record_values(p_operation uuid,p_native_request uuid,p_values bytea)
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare original public.custodial_native_retained_evidence%rowtype;stored public.custodial_private_retained_record_values%rowtype;attempt public.custodial_private_retained_value_requests%rowtype;count_records integer;replay boolean:=false;
begin
 if p_native_request is null or not exists(select 1 from public.custodial_native_retained_evidence_requests where native_request_id=p_native_request and operation_id=p_operation) then raise exception using errcode='42501',message='original committed request witness required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('custodial-private-value-retention:'||p_operation::text,0));
 count_records:=public.custodial_private_assert_original_record_values(p_operation,p_values);
 select * into strict original from public.custodial_native_retained_evidence where operation_id=p_operation;
 select * into stored from public.custodial_private_retained_record_values where operation_id=p_operation;
 if found then
  if stored.parent_wire_sha256 is distinct from original.wire_sha256 or stored.values_bytes is distinct from p_values or stored.record_count<>count_records then raise exception using errcode='23505',message='immutable original values conflict';end if;replay:=true;
 else
  insert into public.custodial_private_retained_record_values(operation_id,native_request_id,parent_wire_sha256,values_bytes,values_sha256,record_count)
   values(p_operation,p_native_request,original.wire_sha256,p_values,pg_catalog.encode(extensions.digest(p_values,'sha256'),'hex'),count_records) returning * into stored;
 end if;
 select * into attempt from public.custodial_private_retained_value_requests where native_request_id=p_native_request;
 if found then
  if attempt.operation_id<>p_operation or attempt.values_sha256<>stored.values_sha256 then raise exception using errcode='23505',message='exact value request identity conflict';end if;
 else insert into public.custodial_private_retained_value_requests(native_request_id,operation_id,values_sha256) values(p_native_request,p_operation,stored.values_sha256);end if;
 return pg_catalog.jsonb_build_object('schema','custodial.private-raw-values-retention.v1','operation_id',stored.operation_id,'native_request_id',p_native_request,'parent_wire_sha256',stored.parent_wire_sha256,'values_sha256',stored.values_sha256,'values_bytes',pg_catalog.octet_length(stored.values_bytes),'record_count',stored.record_count,'replayed',replay,'record_values_retained',true,'native_semantic_inventory_state','UNKNOWN','browser_inventory_state','UNKNOWN','inventory_acknowledged',false,'work_accepted',false,'new_work_allowed',false,'phone_released',false,'key_removal',false);
end $function$;
revoke all on function public.custodial_private_retain_original_record_values(uuid,uuid,bytea) from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

create function public.custodial_private_read_original_record_values(p_operation uuid,p_native_request uuid)
returns bytea language plpgsql stable security invoker set search_path='' as $function$
declare original public.custodial_native_retained_evidence%rowtype;stored public.custodial_private_retained_record_values%rowtype;
begin
 if p_native_request is null or not exists(select 1 from public.custodial_native_retained_evidence_requests where native_request_id=p_native_request and operation_id=p_operation) then raise exception using errcode='42501',message='exact original request witness required';end if;
 select * into stored from public.custodial_private_retained_record_values where operation_id=p_operation;
 if not found then return null;end if;
 if not exists(select 1 from public.custodial_private_retained_value_requests where native_request_id=p_native_request and operation_id=p_operation and values_sha256=stored.values_sha256) then return null;end if;
 select * into strict original from public.custodial_native_retained_evidence where operation_id=p_operation;
 if stored.parent_wire_sha256 is distinct from original.wire_sha256 or stored.values_sha256 is distinct from pg_catalog.encode(extensions.digest(stored.values_bytes,'sha256'),'hex') then raise exception using errcode='23514',message='retained original values drift';end if;
 perform public.custodial_private_assert_original_record_values(p_operation,stored.values_bytes);
 return stored.values_bytes;
end $function$;
revoke all on function public.custodial_private_read_original_record_values(uuid,uuid) from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

-- UNINTEGRATED owner-private chunk/attempt ledger. No runtime grants, native
-- emitter, public HTTP registration, semantic ACK/finalizer or key effect.
-- Requires unchanged prior private-record-value-storage.sql and original251.
create table public.custodial_private_retained_value_chunks (
 operation_id uuid not null references public.custodial_native_retained_evidence(operation_id),
 chunk_index integer not null check(chunk_index between 0 and 1706),
 native_request_id uuid not null references public.custodial_native_retained_evidence_requests(native_request_id),
 parent_wire_sha256 text not null check(parent_wire_sha256 ~ '^[0-9a-f]{64}$'),
 value_bytes integer not null check(value_bytes between 1 and 41943040),
 value_sha256 text not null check(value_sha256 ~ '^[0-9a-f]{64}$'),
 chunk_count integer not null check(chunk_count between 1 and 1707),
 chunk_bytes bytea not null check(octet_length(chunk_bytes) between 1 and 24576),
 chunk_sha256 text not null check(chunk_sha256 ~ '^[0-9a-f]{64}$'),
 retained_at timestamptz not null default clock_timestamp() check(isfinite(retained_at)),
 primary key(operation_id,chunk_index),
 check(chunk_count=(value_bytes+24575)/24576 and chunk_index<chunk_count),
 check(octet_length(chunk_bytes)=least(24576,value_bytes-chunk_index*24576)),
 check(chunk_sha256=encode(extensions.digest(chunk_bytes,'sha256'),'hex'))
);
create index private_value_chunks_native_request_idx on public.custodial_private_retained_value_chunks(native_request_id);
create table public.custodial_private_retained_chunk_requests (
 native_request_id uuid primary key references public.custodial_native_retained_evidence_requests(native_request_id),
 operation_id uuid not null,
 chunk_index integer not null,
 chunk_sha256 text not null check(chunk_sha256 ~ '^[0-9a-f]{64}$'),
 received_at timestamptz not null default clock_timestamp() check(isfinite(received_at)),
 foreign key(operation_id,chunk_index) references public.custodial_private_retained_value_chunks(operation_id,chunk_index)
);
create index private_chunk_requests_operation_idx on public.custodial_private_retained_chunk_requests(operation_id,chunk_index);
alter table public.custodial_private_retained_value_chunks enable row level security;
alter table public.custodial_private_retained_value_chunks force row level security;
alter table public.custodial_private_retained_chunk_requests enable row level security;
alter table public.custodial_private_retained_chunk_requests force row level security;
revoke all on public.custodial_private_retained_value_chunks,public.custodial_private_retained_chunk_requests from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;
create trigger trg_private_value_chunks_immutable before update or delete on public.custodial_private_retained_value_chunks for each row execute function public.custodial_v15_reject_retained_evidence_mutation();
create trigger trg_private_value_chunks_no_truncate before truncate on public.custodial_private_retained_value_chunks for each statement execute function public.custodial_v15_reject_retained_evidence_mutation();
create trigger trg_private_chunk_requests_immutable before update or delete on public.custodial_private_retained_chunk_requests for each row execute function public.custodial_v15_reject_retained_evidence_mutation();
create trigger trg_private_chunk_requests_no_truncate before truncate on public.custodial_private_retained_chunk_requests for each statement execute function public.custodial_v15_reject_retained_evidence_mutation();
alter table public.custodial_private_retained_value_chunks enable always trigger trg_private_value_chunks_immutable;
alter table public.custodial_private_retained_value_chunks enable always trigger trg_private_value_chunks_no_truncate;
alter table public.custodial_private_retained_chunk_requests enable always trigger trg_private_chunk_requests_immutable;
alter table public.custodial_private_retained_chunk_requests enable always trigger trg_private_chunk_requests_no_truncate;

create function public.custodial_private_parse_original_value_chunk(p_operation uuid,p_native_request uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $function$
declare original public.custodial_native_retained_evidence%rowtype;attempt public.custodial_native_retained_evidence_requests%rowtype;
 raw json;frame jsonb;keys text[];key text;part bytea;total integer;idx integer;parts integer;wire bytea;
begin
 select * into original from public.custodial_native_retained_evidence where operation_id=p_operation;
 if not found then raise exception using errcode='42501',message='committed original operation required';end if;
 select * into attempt from public.custodial_native_retained_evidence_requests where operation_id=p_operation and native_request_id=p_native_request;
 if not found then raise exception using errcode='42501',message='committed original chunk request required';end if;
 if attempt.request_sha256 is distinct from pg_catalog.encode(extensions.digest(attempt.request_bytes,'sha256'),'hex')
  or original.wire_sha256 is distinct from pg_catalog.encode(extensions.digest(original.wire_bytes,'sha256'),'hex')
  or pg_catalog.octet_length(attempt.request_bytes) not between 1 and 393216 then raise exception using errcode='23514',message='original chunk request/wire drift';end if;
 raw:=pg_catalog.convert_from(attempt.request_bytes,'UTF8')::json;perform public.custodial_v15_assert_native_json(raw);frame:=raw::jsonb;
 select array_agg(k order by k collate "C") into keys from pg_catalog.jsonb_object_keys(frame) k;
 if keys is distinct from array['chunk_base64','chunk_count','chunk_index','chunk_sha256','generation_id','operation_id','schema','signed_wire_base64','value_bytes','value_sha256']::text[] then raise exception using errcode='22023',message='closed original chunk envelope required';end if;
 foreach key in array keys loop
  if pg_catalog.jsonb_typeof(frame->key) is distinct from 'string' then raise exception using errcode='22023',message='literal original chunk fields required';end if;
 end loop;
 if frame->>'schema' is distinct from 'custodial.original-native-value-chunk-intake.v1'
  or frame->>'operation_id' is distinct from p_operation::text or frame->>'generation_id' is distinct from original.generation_id::text
  or frame->>'signed_wire_base64' !~ '^[A-Za-z0-9+/]+={0,2}$'
  or frame->>'chunk_base64' !~ '^[A-Za-z0-9+/]+={0,2}$'
  or frame->>'value_sha256' !~ '^[0-9a-f]{64}$' or frame->>'chunk_sha256' !~ '^[0-9a-f]{64}$'
  then raise exception using errcode='22023',message='exact original chunk identity required';end if;
 foreach key in array array['value_bytes','chunk_index','chunk_count'] loop
  if length(frame->>key)>8 or frame->>key !~ '^(0|[1-9][0-9]*)$' then raise exception using errcode='22023',message='canonical bounded chunk integer text required';end if;
 end loop;
 total:=(frame->>'value_bytes')::integer;idx:=(frame->>'chunk_index')::integer;parts:=(frame->>'chunk_count')::integer;
 wire:=pg_catalog.decode(frame->>'signed_wire_base64','base64');part:=pg_catalog.decode(frame->>'chunk_base64','base64');
 if wire is distinct from original.wire_bytes or pg_catalog.replace(pg_catalog.encode(wire,'base64'),E'\n','') is distinct from frame->>'signed_wire_base64'
  or total not between 1 and 41943040 or parts<>(total+24575)/24576 or idx not between 0 and parts-1
  or pg_catalog.octet_length(part)<>least(24576,total-idx*24576)
  or pg_catalog.replace(pg_catalog.encode(part,'base64'),E'\n','') is distinct from frame->>'chunk_base64'
  or pg_catalog.encode(extensions.digest(part,'sha256'),'hex') is distinct from frame->>'chunk_sha256'
  then raise exception using errcode='22023',message='canonical exact bounded original chunk required';end if;
 return frame;
end $function$;
revoke all on function public.custodial_private_parse_original_value_chunk(uuid,uuid) from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

create function public.custodial_private_read_original_value_chunk(p_operation uuid,p_native_request uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $function$
declare frame jsonb;part public.custodial_private_retained_value_chunks%rowtype;attempt public.custodial_private_retained_chunk_requests%rowtype;
 native public.custodial_native_retained_evidence_requests%rowtype;archive public.custodial_private_retained_record_values%rowtype;
 stored integer;complete boolean:=false;
begin
 frame:=public.custodial_private_parse_original_value_chunk(p_operation,p_native_request);
 select * into attempt from public.custodial_private_retained_chunk_requests where operation_id=p_operation and native_request_id=p_native_request;
 if not found then return null;end if;
 select * into strict native from public.custodial_native_retained_evidence_requests where native_request_id=p_native_request and operation_id=p_operation;
 select * into strict part from public.custodial_private_retained_value_chunks where operation_id=p_operation and chunk_index=attempt.chunk_index;
 if part.chunk_index<>(frame->>'chunk_index')::integer or part.chunk_count<>(frame->>'chunk_count')::integer or part.value_bytes<>(frame->>'value_bytes')::integer
  or part.value_sha256 is distinct from frame->>'value_sha256' or part.chunk_sha256 is distinct from frame->>'chunk_sha256' or attempt.chunk_sha256 is distinct from part.chunk_sha256
  or part.chunk_bytes is distinct from pg_catalog.decode(frame->>'chunk_base64','base64')
  or part.chunk_sha256 is distinct from pg_catalog.encode(extensions.digest(part.chunk_bytes,'sha256'),'hex')
  or part.parent_wire_sha256 is distinct from (select wire_sha256 from public.custodial_native_retained_evidence where operation_id=p_operation)
  then raise exception using errcode='23514',message='durable original chunk/attempt drift';end if;
 select count(*) into stored from public.custodial_private_retained_value_chunks where operation_id=p_operation;
 if exists(select 1 from public.custodial_private_retained_value_chunks where operation_id=p_operation and (value_bytes<>part.value_bytes or value_sha256<>part.value_sha256 or chunk_count<>part.chunk_count or parent_wire_sha256<>part.parent_wire_sha256)) then raise exception using errcode='23514',message='original chunk stream drift';end if;
 select * into archive from public.custodial_private_retained_record_values where operation_id=p_operation;
 if found then
  if stored<>part.chunk_count or archive.values_sha256 is distinct from part.value_sha256 or pg_catalog.octet_length(archive.values_bytes)<>part.value_bytes or archive.parent_wire_sha256 is distinct from part.parent_wire_sha256 then raise exception using errcode='23514',message='complete original value archive binding drift';end if;
  perform public.custodial_private_assert_original_record_values(p_operation,archive.values_bytes);
  if archive.values_sha256 is distinct from pg_catalog.encode(extensions.digest(archive.values_bytes,'sha256'),'hex') then raise exception using errcode='23514',message='complete original value bytes drift';end if;
  complete:=true;
 end if;
 return pg_catalog.jsonb_build_object('schema','custodial.private-native-value-chunk-readback.v1','operation_id',p_operation,'native_request_id',p_native_request,
  'request_body_sha256',native.request_sha256,'attestation_digest',native.attestation_digest,'wire_sha256',part.parent_wire_sha256,
  'value_bytes',part.value_bytes,'value_sha256',part.value_sha256,'chunk_index',part.chunk_index,'chunk_count',part.chunk_count,
  'chunk_bytes',pg_catalog.octet_length(part.chunk_bytes),'chunk_sha256',part.chunk_sha256,'chunk_base64',pg_catalog.replace(pg_catalog.encode(part.chunk_bytes,'base64'),E'\n',''),
  'stored_chunk_count',stored,'record_values_retained',complete,'native_semantic_inventory_state','UNKNOWN','browser_inventory_state','UNKNOWN',
  'inventory_acknowledged',false,'work_accepted',false,'new_work_allowed',false,'phone_released',false,'key_removal',false);
end $function$;
revoke all on function public.custodial_private_read_original_value_chunk(uuid,uuid) from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

create function public.custodial_private_retain_original_value_chunk(p_operation uuid,p_native_request uuid)
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare frame jsonb;part public.custodial_private_retained_value_chunks%rowtype;first_part public.custodial_private_retained_value_chunks%rowtype;
 attempt public.custodial_private_retained_chunk_requests%rowtype;stored integer;assembled bytea;replayed boolean:=false;status jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('custodial-private-value-chunk-retention:'||p_operation::text,0));
 frame:=public.custodial_private_parse_original_value_chunk(p_operation,p_native_request);
 select * into first_part from public.custodial_private_retained_value_chunks where operation_id=p_operation order by chunk_index limit 1;
 if found and (first_part.value_bytes<>(frame->>'value_bytes')::integer or first_part.value_sha256 is distinct from frame->>'value_sha256' or first_part.chunk_count<>(frame->>'chunk_count')::integer) then raise exception using errcode='23505',message='immutable original chunk stream conflict';end if;
 select * into part from public.custodial_private_retained_value_chunks where operation_id=p_operation and chunk_index=(frame->>'chunk_index')::integer;
 if found then
  if part.chunk_bytes is distinct from pg_catalog.decode(frame->>'chunk_base64','base64') or part.chunk_sha256 is distinct from frame->>'chunk_sha256' then raise exception using errcode='23505',message='immutable original chunk bytes conflict';end if;replayed:=true;
 else
  insert into public.custodial_private_retained_value_chunks(operation_id,chunk_index,native_request_id,parent_wire_sha256,value_bytes,value_sha256,chunk_count,chunk_bytes,chunk_sha256)
  select p_operation,(frame->>'chunk_index')::integer,p_native_request,wire_sha256,(frame->>'value_bytes')::integer,frame->>'value_sha256',(frame->>'chunk_count')::integer,pg_catalog.decode(frame->>'chunk_base64','base64'),frame->>'chunk_sha256' from public.custodial_native_retained_evidence where operation_id=p_operation returning * into strict part;
 end if;
 select * into attempt from public.custodial_private_retained_chunk_requests where native_request_id=p_native_request;
 if found then
  if attempt.operation_id<>p_operation or attempt.chunk_index<>part.chunk_index or attempt.chunk_sha256<>part.chunk_sha256 then raise exception using errcode='23505',message='exact native chunk attempt conflict';end if;
 else insert into public.custodial_private_retained_chunk_requests(native_request_id,operation_id,chunk_index,chunk_sha256) values(p_native_request,p_operation,part.chunk_index,part.chunk_sha256);end if;
 select count(*) into stored from public.custodial_private_retained_value_chunks where operation_id=p_operation;
 if stored=part.chunk_count then
  select pg_catalog.string_agg(chunk_bytes,''::bytea order by chunk_index) into assembled from public.custodial_private_retained_value_chunks where operation_id=p_operation;
  if pg_catalog.octet_length(assembled)<>part.value_bytes or pg_catalog.encode(extensions.digest(assembled,'sha256'),'hex') is distinct from part.value_sha256 then raise exception using errcode='23514',message='complete original chunk bytes/digest mismatch';end if;
  perform public.custodial_private_retain_original_record_values(p_operation,p_native_request,assembled);
 end if;
 status:=public.custodial_private_read_original_value_chunk(p_operation,p_native_request);
 if status is null then raise exception using errcode='23514',message='actual chunk attempt readback missing';end if;
 return status||pg_catalog.jsonb_build_object('chunk_replayed',replayed);
end $function$;
revoke all on function public.custodial_private_retain_original_value_chunk(uuid,uuid) from public,anon,authenticated,service_role,custodial_application_reader,static_weekly_control_plane,static_weekly_release_operator;

-- UNINTEGRATED same-signature replacement draft. Existing owner/ACL remain;
-- no new SECURITY DEFINER function or runtime grant is created.
create or replace function public.custodial_v15_retain_original_native_evidence(
 p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_generation uuid,
 p_native_request uuid,p_attestation_digest text,p_request_base64 text,p_binding jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare c public.device_auth_credentials%rowtype;f public.custodial_employee_separation_fences%rowtype;
 context jsonb;generation jsonb;frame jsonb;wire jsonb;body jsonb;raw json;
 request_bytes bytea;wire_bytes bytea;wire_digest text;request_digest text;
 prior public.custodial_native_retained_evidence%rowtype;attempt public.custodial_native_retained_evidence_requests%rowtype;replayed boolean:=false;
 keys text[];k text;item json;prev text:='';records_text text:='[';principal_text text;principal_schema text;entry record;is_chunk boolean:=false;chunk_result jsonb;
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
 is_chunk:=coalesce(frame->>'schema'='custodial.original-native-value-chunk-intake.v1',false);
 if keys is distinct from (case when is_chunk then array['chunk_base64','chunk_count','chunk_index','chunk_sha256','generation_id','operation_id','schema','signed_wire_base64','value_bytes','value_sha256']::text[] else array['generation_id','operation_id','schema','signed_wire_base64']::text[] end)
  or pg_catalog.jsonb_typeof(frame->'schema') is distinct from 'string'
  or frame->>'schema' not in ('custodial.original-native-evidence-intake.v1','custodial.original-native-value-chunk-intake.v1')
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
 if is_chunk then chunk_result:=public.custodial_private_retain_original_value_chunk(p_operation,p_native_request);end if;
 return pg_catalog.jsonb_build_object('receipt',public.custodial_v15_retained_evidence_receipt(prior),'replayed',replayed,'native_request_id',p_native_request,'request_body_sha256',request_digest)
  ||case when is_chunk then pg_catalog.jsonb_build_object('value_chunk',chunk_result) else '{}'::jsonb end;
end $function$;

create or replace function public.custodial_v15_read_retained_native_evidence(p_operation uuid,p_device uuid,p_credential uuid,p_credential_hash text,p_credential_key_id text,p_native_request uuid default null)
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
  if found and (pg_catalog.convert_from(attempt.request_bytes,'UTF8')::jsonb)->>'schema'='custodial.original-native-value-chunk-intake.v1' then
   result:=result||pg_catalog.jsonb_build_object('value_chunk',public.custodial_private_read_original_value_chunk(p_operation,p_native_request));
  end if;
 end if;return result;
end $function$;


DO $rpc_identity$ BEGIN
 IF EXISTS(SELECT 1 FROM retained_values_functions_before f JOIN pg_proc p ON p.oid=f.oid
  WHERE p.proacl IS DISTINCT FROM f.acl OR p.proowner IS DISTINCT FROM f.owner)
  OR (SELECT count(*) FROM retained_values_functions_before f JOIN pg_proc p ON p.oid=f.oid)<>3 THEN
  RAISE EXCEPTION 'Retained values changed existing RPC/canary identity owner or ACL';END IF;
END $rpc_identity$;

-- Exact new relations/private helpers only. PK/unique/check constraints receive
-- lower new restore slots than FK constraints, including chunk-request->chunk.
CREATE TEMP TABLE retained_values_objects ON COMMIT DROP AS
 WITH funcs AS(SELECT p.oid FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN(
  'custodial_private_assert_original_record_values','custodial_private_retain_original_record_values','custodial_private_read_original_record_values',
  'custodial_private_parse_original_value_chunk','custodial_private_read_original_value_chunk','custodial_private_retain_original_value_chunk')),
 objects AS(
 SELECT 100000 bucket,0 priority,'function'::text kind,'public.'||oid::regprocedure::text identity,pg_get_functiondef(oid) definition FROM funcs
 UNION ALL SELECT 900000,0,'grant','public.'||oid::regprocedure::text,public.custodial_release_authority_current_grant_definition('public.'||oid::regprocedure::text) FROM funcs
 UNION ALL SELECT x.bucket,x.priority,x.kind,x.identity,x.definition FROM unnest(array[
  'public.custodial_private_retained_record_values','public.custodial_private_retained_value_requests',
  'public.custodial_private_retained_value_chunks','public.custodial_private_retained_chunk_requests']) rel CROSS JOIN LATERAL(
  SELECT 1000 bucket,0 priority,'relation'::text kind,rel identity,public.custodial_release_authority_current_relation_definition(rel) definition
  UNION ALL SELECT 200000,0,'column',rel||':'||attname,public.custodial_release_authority_current_column_definition(rel||':'||attname)
   FROM pg_attribute WHERE attrelid=rel::regclass AND attnum>0 AND NOT attisdropped
  UNION ALL SELECT 300000,0,'column_set',rel,public.custodial_release_authority_current_column_set_definition(rel)
  UNION ALL SELECT 400000,0,'relation_state',rel,public.custodial_release_authority_current_relation_state_definition(rel)
  UNION ALL SELECT 500000,CASE WHEN contype='f' THEN 1 ELSE 0 END,'constraint',rel||':'||conname,public.custodial_release_authority_current_constraint_definition(rel||':'||conname)
   FROM pg_constraint WHERE conrelid=rel::regclass
  UNION ALL SELECT 600000,0,'index',indexrelid::regclass::text,public.custodial_release_authority_current_index_definition(indexrelid::regclass::text)
   FROM pg_index i WHERE indrelid=rel::regclass AND NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conindid=i.indexrelid)
  UNION ALL SELECT 700000,0,'trigger',rel||'.'||tgname,'drop trigger if exists '||quote_ident(tgname)||' on '||rel||'; '
   ||pg_get_triggerdef(oid,true)||'; alter table '||rel||CASE WHEN tgenabled='A' THEN ' enable always trigger ' ELSE ' enable trigger ' END||quote_ident(tgname)||';'
   FROM pg_trigger WHERE tgrelid=rel::regclass AND NOT tgisinternal
  UNION ALL SELECT 800000,0,'policy',rel||':'||polname,public.custodial_release_authority_current_policy_definition(rel||':'||polname)
   FROM pg_policy WHERE polrelid=rel::regclass
  UNION ALL SELECT 900000,0,'grant',rel,public.custodial_release_authority_current_grant_definition(rel)) x)
 SELECT * FROM objects;
DO $objects$ BEGIN
 IF (SELECT count(*) FROM retained_values_objects WHERE kind='function')<>6
  OR (SELECT count(*) FROM retained_values_objects WHERE kind='relation')<>4
  OR (SELECT count(*) FROM retained_values_objects WHERE kind='column')<>26
  OR (SELECT count(*) FROM retained_values_objects WHERE kind='constraint')<>33
  OR (SELECT count(*) FROM retained_values_objects WHERE kind='index')<>2
  OR (SELECT count(*) FROM retained_values_objects WHERE kind='trigger')<>12
  OR (SELECT count(*) FROM retained_values_objects WHERE kind='policy')<>0
  OR (SELECT count(*) FROM retained_values_objects WHERE kind='grant')<>10
  OR (SELECT count(*) FROM pg_trigger WHERE tgrelid IN('public.custodial_private_retained_record_values'::regclass,
   'public.custodial_private_retained_value_requests'::regclass,'public.custodial_private_retained_value_chunks'::regclass,
   'public.custodial_private_retained_chunk_requests'::regclass) AND tgname='custodial_disaster_restore_mutation_fence'
   AND tgfoid='custodial_dr.guard_application_mutation()'::regprocedure AND tgenabled='O')<>4
  OR (SELECT count(*) FROM pg_trigger WHERE tgrelid IN('public.custodial_private_retained_record_values'::regclass,
   'public.custodial_private_retained_value_requests'::regclass,'public.custodial_private_retained_value_chunks'::regclass,
   'public.custodial_private_retained_chunk_requests'::regclass) AND NOT tgisinternal AND tgname<>'custodial_disaster_restore_mutation_fence' AND tgenabled='A')<>8
  OR EXISTS(SELECT 1 FROM retained_values_objects WHERE definition IS NULL)
  OR EXISTS(SELECT kind,identity FROM retained_values_objects GROUP BY kind,identity HAVING count(*)<>1)
  OR EXISTS(SELECT 1 FROM retained_values_inventory_before old JOIN retained_values_objects x ON x.kind=old.object_kind AND x.identity=old.object_identity) THEN
  RAISE EXCEPTION 'Retained values finite source object declaration changed';END IF;
END $objects$;
DO $surface$ DECLARE original text;patched text;entries text;BEGIN
 SELECT definition INTO STRICT original FROM retained_values_functions_before WHERE proname='custodial_release_canary_authority_surface';
 IF (length(original)-length(replace(original,'  values','')))/length('  values')<>1 THEN RAISE EXCEPTION 'Retained values canary source anchor changed';END IF;
 SELECT string_agg('('||quote_literal(kind)||','||quote_literal(identity)||','||quote_literal('private original raw-value retention only; no semantic ACK, accepted work or key/reuse authority')||'),',E'\n' ORDER BY kind,identity) INTO entries FROM retained_values_objects;
 patched:=replace(original,'  values','  values'||E'\n'||entries);EXECUTE patched;
 IF pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure) IS DISTINCT FROM patched
  OR (SELECT proacl FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure)
   IS DISTINCT FROM (SELECT acl FROM retained_values_functions_before WHERE proname='custodial_release_canary_authority_surface')
  OR (SELECT proowner FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure)
   IS DISTINCT FROM (SELECT owner FROM retained_values_functions_before WHERE proname='custodial_release_canary_authority_surface') THEN
  RAISE EXCEPTION 'Retained values canary owner/ACL/body changed outside finite extension';END IF;
END $surface$;
ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $recovery$ DECLARE obj record;next_order integer;changed integer;BEGIN
 UPDATE public.custodial_release_authority_restore_inventory i SET definition_sql=pg_get_functiondef(f.oid),
  definition_sha256=public.static_weekly_digest_text(pg_get_functiondef(f.oid)),captured_at=statement_timestamp()
  FROM retained_values_functions_before f WHERE i.object_kind='function' AND i.object_identity LIKE '%(%'
   AND to_regprocedure(i.object_identity)=f.oid AND i.definition_sql=f.definition;
 GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>3 THEN RAISE EXCEPTION 'Retained values captured function predecessor changed';END IF;
 FOR obj IN SELECT * FROM retained_values_objects ORDER BY bucket,priority,identity LOOP
  SELECT n INTO next_order FROM generate_series(obj.bucket+1,CASE WHEN obj.bucket=1000 THEN 99998 ELSE obj.bucket+99998 END) n
   WHERE NOT EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory WHERE restore_order=n) ORDER BY n LIMIT 1;
  IF next_order IS NULL THEN RAISE EXCEPTION 'Retained values recovery order exhausted';END IF;
  INSERT INTO public.custodial_release_authority_restore_inventory(restore_order,object_kind,object_identity,definition_sql,definition_sha256)
   VALUES(next_order,obj.kind,obj.identity,obj.definition,public.static_weekly_digest_text(obj.definition));
 END LOOP;
END $recovery$;
ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
DO $scope$ DECLARE fk_count integer;BEGIN
 IF (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>
   (SELECT count(*) FROM retained_values_inventory_before)+(SELECT count(*) FROM retained_values_objects)
  OR EXISTS(SELECT old.* FROM retained_values_inventory_before old WHERE NOT(object_kind='function' AND object_identity LIKE '%(%'
    AND to_regprocedure(object_identity) IN(SELECT oid FROM retained_values_functions_before)) EXCEPT SELECT * FROM public.custodial_release_authority_restore_inventory)
  OR EXISTS(SELECT current.* FROM public.custodial_release_authority_restore_inventory current WHERE NOT(object_kind='function' AND object_identity LIKE '%(%'
    AND to_regprocedure(object_identity) IN(SELECT oid FROM retained_values_functions_before))
    AND NOT EXISTS(SELECT 1 FROM retained_values_objects x WHERE x.kind=current.object_kind AND x.identity=current.object_identity)
    EXCEPT SELECT * FROM retained_values_inventory_before) THEN RAISE EXCEPTION 'Unrelated retained values recovery scope changed';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
   AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
  OR EXISTS(SELECT 1 FROM retained_values_objects x JOIN public.custodial_release_authority_restore_inventory i
    ON x.kind=i.object_kind AND x.identity=i.object_identity WHERE i.definition_sql IS DISTINCT FROM x.definition OR i.definition_sha256 IS DISTINCT FROM public.static_weekly_digest_text(x.definition))
  OR EXISTS(SELECT 1 FROM retained_values_functions_before f JOIN pg_proc p ON p.oid=f.oid WHERE p.proacl IS DISTINCT FROM f.acl OR p.proowner IS DISTINCT FROM f.owner) THEN
  RAISE EXCEPTION 'Retained values final guard/definitions/owner/ACL drift';END IF;
 SELECT count(*) INTO fk_count FROM pg_constraint fk JOIN pg_constraint pk ON pk.conrelid=fk.confrelid AND pk.conindid=fk.conindid
   JOIN public.custodial_release_authority_restore_inventory fi ON fi.object_kind='constraint' AND fi.object_identity='public.'||fk.conrelid::regclass::text||':'||fk.conname
   JOIN public.custodial_release_authority_restore_inventory pi ON pi.object_kind='constraint' AND pi.object_identity='public.'||pk.conrelid::regclass::text||':'||pk.conname
   WHERE fk.contype='f' AND fk.conrelid IN('public.custodial_private_retained_record_values'::regclass,'public.custodial_private_retained_value_requests'::regclass,
    'public.custodial_private_retained_value_chunks'::regclass,'public.custodial_private_retained_chunk_requests'::regclass);
 IF fk_count<>8 OR EXISTS(SELECT 1 FROM pg_constraint fk JOIN pg_constraint pk ON pk.conrelid=fk.confrelid AND pk.conindid=fk.conindid
   JOIN public.custodial_release_authority_restore_inventory fi ON fi.object_kind='constraint' AND fi.object_identity='public.'||fk.conrelid::regclass::text||':'||fk.conname
   JOIN public.custodial_release_authority_restore_inventory pi ON pi.object_kind='constraint' AND pi.object_identity='public.'||pk.conrelid::regclass::text||':'||pk.conname
   WHERE fk.contype='f' AND fk.conrelid IN('public.custodial_private_retained_record_values'::regclass,'public.custodial_private_retained_value_requests'::regclass,
    'public.custodial_private_retained_value_chunks'::regclass,'public.custodial_private_retained_chunk_requests'::regclass) AND fi.restore_order<=pi.restore_order) THEN
  RAISE EXCEPTION 'Retained values FK restore precedes its referenced key';END IF;
END $scope$;
COMMIT;
