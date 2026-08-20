-- Remove the remaining accidental public RPC grants on privileged wrappers and
-- the trigger function. Secret validation inside a definer function is defense
-- in depth; it is not a reason to expose the function to PUBLIC.

begin;

revoke all privileges on function public.custodial_claim_offline_reconciliation_notification_recipients(uuid,text,uuid,jsonb,text)
  from public, anon, authenticated;
revoke all privileges on function public.custodial_close_maintenance_ticket_authoritative(uuid,text,text,text)
  from public, anon, authenticated;
revoke all privileges on function public.custodial_finish_offline_reconciliation_notification_recipient(uuid,text,uuid,boolean,uuid,text,integer,boolean,jsonb,text)
  from public, anon, authenticated;
revoke all privileges on function public.custodial_manager_dispose_offline_reconciliation(uuid,uuid,text,text,uuid,text)
  from public, anon, authenticated;
revoke all privileges on function public.custodial_record_offline_authority_activation_boundary()
  from public, anon, authenticated, service_role;

-- New functions start private and must receive an explicit reviewed grant.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

commit;
