CREATE OR REPLACE FUNCTION public.static_weekly_v3_manager_actor(p_manager_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_name text;
begin
  if exists(select 1 from custodial_leadership_private.policy p where p.cohort_principal_id=p_manager_id) then
    return custodial_leadership_private.require_context(p_manager_id,'custodialManagementAdmin');
  end if;
  select display_name into v_name from public.ops_manager_managers where manager_id=p_manager_id and active=true and revoked_at is null and is_system_principal=false and roles && array['OPS_MANAGER','CUSTODIAL_MANAGER','DIRECTOR','SECURITY_ADMIN']::text[] for share;
  if nullif(btrim(v_name),'') is null then raise exception using errcode='42501',message='an authorized active named manager principal is required'; end if;
  return jsonb_build_object('manager_id',p_manager_id::text,'manager_name',v_name);
end
$function$
