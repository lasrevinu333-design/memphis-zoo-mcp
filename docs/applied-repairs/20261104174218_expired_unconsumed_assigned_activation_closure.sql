begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
-- Return a terminal no-credential proof only for the exact expired, unused
-- transport capability. This cannot authorize issuance or discard old work.
do $repair$
declare
 target regprocedure := 'public.device_auth_consume_enrollment_operation(uuid,text,uuid,text,text,uuid,text,text,timestamptz,text,text,text,timestamptz,text,text,text,jsonb)'::regprocedure;
 d text := pg_get_functiondef(target);
 trigger_mode text;
 old_seam text := E'  if exists(select 1 from public.custodial_assigned_activation_operations where operation_id=p_operation_id) then\n   perform public.custodial_activation_assert_consume(p_operation_id,p_device_id,p_code_hash);';
 new_seam text := $new$
  if exists(select 1 from public.custodial_assigned_activation_operations where operation_id=p_operation_id) then
   perform public.custodial_begin_application_mutation();
   perform 1 from public.devices where id=p_device_id for update;
   select * into v_activation from public.custodial_assigned_activation_operations
    where operation_id=p_operation_id for update;
   if v_activation.state='expired' and v_activation.terminal_at is not null
      and v_activation.expires_at<=v_now and v_activation.device_id=p_device_id
      and v_activation.claimant_credential_id is not null then
    select * into v_code from public.device_auth_enrollment_codes
     where enrollment_id=v_activation.enrollment_id for update;
    if v_code.enrollment_id is not null and v_code.device_id=p_device_id
       and v_code.code_hash=p_code_hash and v_code.consumed_at is null
       and v_code.expires_at<=v_now and v_code.revoked_at is not null
       and v_code.metadata_json->>'purpose'='assigned_device_activation'
       and v_code.metadata_json->>'operation_id'=p_operation_id::text
       and v_code.metadata_json->>'device_id'=p_device_id::text
       and v_code.metadata_json->>'canonical_device_id'=v_activation.canonical_device_id
       and v_code.metadata_json->>'employee_id'=v_activation.expected_employee_id::text
       and v_code.metadata_json->>'assignment_epoch'=v_activation.expected_assignment_epoch::text
       and v_code.metadata_json->>'claimant_credential_id'=v_activation.claimant_credential_id::text
       and not exists(select 1 from public.device_auth_enrollment_operations where operation_id=p_operation_id)
    then
     return jsonb_build_object('ok',false,'reason','operation_expired','operation_id',p_operation_id);
    end if;
   end if;
   perform public.custodial_activation_assert_consume(p_operation_id,p_device_id,p_code_hash);$new$;
begin
 if md5(d)<>'13438a8ff8d4e4b46d7a69dcd7e20f81' then raise exception 'consume repair preimage mismatch'; end if;
 if (length(d)-length(replace(d,old_seam,'')))/length(old_seam)<>1
    or (length(d)-length(replace(d,'  v_failed_attempts integer;','')))/length('  v_failed_attempts integer;')<>1
 then raise exception 'consume repair seam mismatch'; end if;
 d:=replace(d,'  v_failed_attempts integer;',E'  v_failed_attempts integer;\n  v_activation public.custodial_assigned_activation_operations%rowtype;');
 d:=replace(d,old_seam,new_seam);
 select tgenabled into strict trigger_mode from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass and tgname='trg_custodial_release_authority_restore_inventory_immutable';
 if trigger_mode not in ('O','A') then raise exception 'enabled recovery guard required'; end if;
 execute d;
 -- Keep the exact restoration definition synchronized; the existing trigger
 -- is suspended only within this transaction, then restored before commit.
 alter table public.custodial_release_authority_restore_inventory disable trigger trg_custodial_release_authority_restore_inventory_immutable;
 update public.custodial_release_authority_restore_inventory
 set definition_sql=pg_get_functiondef(target),
     definition_sha256=public.static_weekly_digest_text(pg_get_functiondef(target)),
     captured_at=statement_timestamp()
 where object_kind='function' and object_identity like '%(%'
   and to_regprocedure(object_identity)=target;
 if not found then raise exception 'consume recovery inventory missing'; end if;
 if trigger_mode='A' then
  alter table public.custodial_release_authority_restore_inventory enable always trigger trg_custodial_release_authority_restore_inventory_immutable;
 else
  alter table public.custodial_release_authority_restore_inventory enable trigger trg_custodial_release_authority_restore_inventory_immutable;
 end if;
end $repair$;
commit;

