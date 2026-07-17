-- Deployed migration history snapshot: 20260714210209 temporary_repair_payload_upload_rpc_20260714

create or replace function public.temporary_upload_repair_payload(
  p_token text,
  p_patch_b64 text,
  p_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_token text := btrim(coalesce(p_token,''));
  v_patch text := coalesce(p_patch_b64,'');
  v_sha text := lower(btrim(coalesce(p_sha256,'')));
  v_expected_sha text;
  v_expected_repo text;
begin
  case v_token
    when 'backend-lgvWP1ffXzT2YCIjP-fQSMkTM71krgYJ' then
      v_expected_sha := '954a7ff7c2ddf2fac53cc9d7ba956ec5e22a0f030e77b7d4fb4dafa5f5cfb17c';
      v_expected_repo := 'lasrevinu333-design/memphis-zoo-mcp';
    when 'frontend-9lLDVUo6fKx4Um4bth3eI3-mB7Z4awue' then
      v_expected_sha := '4c44ef01ed5bed816b3397c30ef605070819fc0999f7d3c6ed5e8326461dccb3';
      v_expected_repo := 'lasrevinu333-design/Engine';
    else
      raise exception 'Invalid repair payload token';
  end case;

  if v_sha <> v_expected_sha then
    raise exception 'Repair payload SHA does not match expected value';
  end if;
  if length(v_patch) < 1000 or length(v_patch) > 100000 then
    raise exception 'Repair payload length is outside the accepted range';
  end if;
  if v_patch !~ '^[A-Za-z0-9+/=]+$' then
    raise exception 'Repair payload is not valid base64 text';
  end if;

  update public.repair_payloads
  set repository_name = v_expected_repo,
      patch_b64 = v_patch,
      patch_sha256 = v_expected_sha,
      created_at = now(),
      expires_at = now() + interval '6 hours'
  where token = v_token;

  if not found then
    insert into public.repair_payloads(token,repository_name,patch_b64,patch_sha256,created_at,expires_at)
    values(v_token,v_expected_repo,v_patch,v_expected_sha,now(),now()+interval '6 hours');
  end if;

  return jsonb_build_object('ok',true,'token',v_token,'repository_name',v_expected_repo,'length',length(v_patch),'expires_at',now()+interval '6 hours');
end
$function$;

revoke all on function public.temporary_upload_repair_payload(text,text,text) from public, authenticated;
grant execute on function public.temporary_upload_repair_payload(text,text,text) to anon;
