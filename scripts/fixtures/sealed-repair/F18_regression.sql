-- Root-owned disposable database only, after canonical successor integration.
-- All fixture rows, broadcasts and receipts roll back. No provider dispatch.
begin;
set local statement_timeout='10000ms';
set local lock_timeout='5000ms';
insert into public.msg_users(id,display_name,role,is_active) values
 ('bc180000-0000-4000-8000-000000000001','F18 Synthetic Broadcast Manager','manager',true),
 ('bc180000-0000-4000-8000-000000000002','F18 Synthetic Broadcast Peer','manager',true);
do $test$
declare a jsonb;b jsonb;before_count integer;
begin
 if not has_function_privilege('service_role','public.msg_broadcast_operation_v1(uuid,text,text,text,boolean)','EXECUTE')
   or has_function_privilege('anon','public.msg_broadcast_operation_v1(uuid,text,text,text,boolean)','EXECUTE')
   or has_function_privilege('authenticated','public.msg_broadcast_operation_v1(uuid,text,text,text,boolean)','EXECUTE')
   or has_table_privilege('service_role','public.msg_broadcast_request_receipts','INSERT')
   or not (select relrowsecurity from pg_class where oid='public.msg_broadcast_request_receipts'::regclass)
 then raise exception 'F18 least-privilege ACL/RLS failure'; end if;
 select to_jsonb(r) into a from public.msg_broadcast_operation_v1('bc180000-0000-4000-8000-000000000001','f18-original','Synthetic','Original payload',false) r;
 select to_jsonb(r) into b from public.msg_broadcast_operation_v1('bc180000-0000-4000-8000-000000000001','f18-original','Synthetic','Original payload',false) r;
 if a is distinct from b then raise exception 'F18 retry changed original result';end if;
 select to_jsonb(r) into b from public.msg_broadcast_operation_v1('bc180000-0000-4000-8000-000000000001','f18-original','Synthetic','Original payload',true) r;
 if a is distinct from b then raise exception 'F18 original-outcome changed result';end if;
 if (select count(*) from public.msg_threads where created_by_user_id='bc180000-0000-4000-8000-000000000001')<>1
 or (select count(*) from public.msg_broadcasts where created_by_user_id='bc180000-0000-4000-8000-000000000001')<>1
 or (select count(*) from public.msg_messages where sender_user_id='bc180000-0000-4000-8000-000000000001')<>1
 then raise exception 'F18 duplicate effect';end if;
 begin
  perform public.msg_broadcast_operation_v1('bc180000-0000-4000-8000-000000000001','f18-original','Synthetic','Changed payload',false);
  raise exception 'F18 changed payload admitted';
 exception when unique_violation then null;end;
 if exists(select 1 from public.msg_broadcast_operation_v1('bc180000-0000-4000-8000-000000000001','f18-unknown','Synthetic','Original payload',true))
 or exists(select 1 from public.msg_broadcast_request_receipts where client_broadcast_id='f18-unknown')
 then raise exception 'F18 outcome reader created a receipt';end if;
 -- Explicit abort after accepted writer: its whole receipt and effects roll back.
 begin
  perform public.msg_broadcast_operation_v1('bc180000-0000-4000-8000-000000000001','f18-aborted','Synthetic','Aborted payload',false);
  raise exception using errcode='P1818',message='synthetic transaction rollback';
 exception when sqlstate 'P1818' then null;end;
 if exists(select 1 from public.msg_broadcast_request_receipts where client_broadcast_id='f18-aborted')
 or (select count(*) from public.msg_threads where created_by_user_id='bc180000-0000-4000-8000-000000000001')<>1
 then raise exception 'F18 rollback left partial effects';end if;
 select to_jsonb(r) into b from public.msg_broadcast_operation_v1('bc180000-0000-4000-8000-000000000002','f18-original','Synthetic','Original payload',false) r;
 if a=b then raise exception 'F18 actor key collision';end if;
 update public.msg_users set is_active=false where id='bc180000-0000-4000-8000-000000000001';
 begin
  perform public.msg_broadcast_operation_v1('bc180000-0000-4000-8000-000000000001','f18-original','Synthetic','Original payload',true);
  raise exception 'F18 revoked sender replay admitted';
 exception when insufficient_privilege then null;end;
 raise notice 'F18_DATABASE_ATOMIC_REPLAY_PAYLOAD_ACTOR_ACL_PASS';
end
$test$;
rollback;
