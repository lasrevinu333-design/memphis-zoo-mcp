-- Immediate, reversible containment for production release-recovery DDL.
-- These helpers are retained for the paused, named-manager recovery controller,
-- but no application/API role may invoke them directly. Rollback, if a later
-- reviewed controller proves it is required, is an explicit per-function GRANT
-- to a dedicated non-login release role; PUBLIC/anon/authenticated/service_role
-- are intentionally not part of the rollback authority.

begin;

revoke all privileges on function public.custodial_release_authority_reset_grants(text)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.custodial_release_authority_restore_column(text,text,text,text,text,text,text,boolean)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.custodial_release_authority_restore_column_set(text,text[])
  from public, anon, authenticated, service_role;
revoke all privileges on function public.custodial_release_authority_restore_constraint(text,text,text)
  from public, anon, authenticated, service_role;

comment on function public.custodial_release_authority_reset_grants(text) is
  'Internal release-recovery DDL helper. Direct API-role execution is prohibited.';
comment on function public.custodial_release_authority_restore_column(text,text,text,text,text,text,text,boolean) is
  'Internal release-recovery DDL helper. Direct API-role execution is prohibited.';
comment on function public.custodial_release_authority_restore_column_set(text,text[]) is
  'Internal release-recovery DDL helper. Direct API-role execution is prohibited.';
comment on function public.custodial_release_authority_restore_constraint(text,text,text) is
  'Internal release-recovery DDL helper. Direct API-role execution is prohibited.';

commit;
