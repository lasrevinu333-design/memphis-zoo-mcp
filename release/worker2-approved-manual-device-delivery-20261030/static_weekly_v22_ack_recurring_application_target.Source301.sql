CREATE OR REPLACE FUNCTION public.static_weekly_v22_ack_recurring_application_target(p_intent uuid, p_device uuid, p_credential uuid, p_employee uuid, p_epoch bigint, p_revision bigint, p_target_digest text, p_rendered_digest text, p_applied_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare t public.static_weekly_recurring_application_intents%rowtype;r public.static_weekly_recurring_application_receipts%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('memphis-static-weekly-authority',0));
 perform public.static_weekly_v19_assert_terminal_principal(p_device,p_credential,p_employee,p_epoch);
 if not exists(select 1 from public.employees where id=p_employee and active=true) then
  raise exception using errcode='42501',message='recurring schedule requires an active employee principal';end if;
 select * into t from public.static_weekly_recurring_application_intents where intent_id=p_intent for share;
 if not found or t.device_id is distinct from p_device or t.credential_id is distinct from p_credential
  or t.employee_id is distinct from p_employee or t.assignment_epoch is distinct from p_epoch
  or t.authority_revision is distinct from p_revision or t.target_digest is distinct from p_target_digest
  or t.view_digest is distinct from p_rendered_digest or p_applied_at is null or not isfinite(p_applied_at)
  or p_applied_at<t.created_at or p_applied_at>clock_timestamp()+interval '5 minutes' then
  raise exception using errcode='23514',message='recurring receipt requires exact principal target rendered-view revision and time';end if;
 select * into r from public.static_weekly_recurring_application_receipts where intent_id=p_intent;
 if found then
  if r.rendered_digest is distinct from p_rendered_digest or r.applied_at is distinct from p_applied_at then
   raise exception using errcode='23505',message='recurring target already has a different receipt';end if;
 else
  insert into public.static_weekly_recurring_application_receipts(intent_id,rendered_digest,applied_at)
   values(p_intent,p_rendered_digest,p_applied_at) returning * into r;
 end if;
 -- This is an immutable historical receipt. The merged reader, not this
 -- response, decides whether it still applies to the CURRENT desired state.
 return jsonb_build_object('intentId',p_intent,'receiptId',r.receipt_id,'applicationStatus','DEVICE_REPORTED_APPLIED',
  'currentAuthorityNotInferred',true,'appliedAt',r.applied_at,'receivedAt',r.received_at);
end
$function$
