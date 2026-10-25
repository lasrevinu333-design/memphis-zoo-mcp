-- SOURCE PROPOSAL ONLY. One function; NOT a registered/applied migration.
-- Compose after the independently accepted immutable owner-context matcher,
-- under Main's existing original-owner/global-xact fence before import begin.
-- Main must register this exact current Source definition before admission;
-- no existing inventory row is UPDATEd and no CLI branch is activated.
-- Retained inventory/application-schema.sql SHA256:
-- a55d04c7c5ef24e5824bc1ac806990e59db23ec900841b5d66df93df523a44dc
-- Retained public.custodial_release_authority_restore_inventory DATA SHA256:
-- 5f1c651ea94ba9d938e07894e1c0fe375286cb139bfe744b4d571370d8de7f12
-- Before full definition: 011cc5921cefe8714f52b821b915686359ac5edb873abd33fec8696cc050f19a
-- Before prosrc:          78ca52bb75851e47e110a3674c744210fec37c0b9c000c2416d3ddf9e785bf05
-- After full definition:  14bde0e8c994bf8b0cb325fe39c6f60dd8531944a8cc766faf921ec2540449be
-- After prosrc:           d97b5d02b929cd6c744fb73953458fedefeebd09d2026a0fbf28196007476fa2
-- Normal INSERT/UPDATE/location behavior remains the ORIGINAL body unless
-- the fixed device INSERT is an exact independently staged original.
-- This suppresses only fresh derived activation work, not UPDATE invalidation.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $immutable_original_device_boundary$
DECLARE
 original_oid oid; owner_oid oid; postgres_oid oid; helper_oid oid; device_oid oid;
 original pg_catalog.pg_proc; observed pg_catalog.pg_proc;
 before_definition text; after_definition text; after_body text;
 insertion_point constant text:=E'\nbegin\n';
 expected_before_definition constant text:=$original_device_definition$
CREATE OR REPLACE FUNCTION public.custodial_record_offline_authority_activation_boundary()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_kind text:=case tg_table_name when 'devices' then 'device' else 'location' end;
begin
  if tg_op='INSERT' or old.active is distinct from new.active then
    insert into public.custodial_offline_authority_activation_events(authority_kind,authority_id,active,occurred_at,source)
    values(v_kind,new.id,new.active,clock_timestamp(),tg_table_schema||'.'||tg_table_name||':'||lower(tg_op));
  end if;
  return new;
end
$function$
$original_device_definition$;
 restore_branch constant text:=$original_device_restore_branch$  -- Exact original device INSERT is not a fresh activation boundary.
  if TG_OP = 'INSERT' and TG_LEVEL = 'ROW' and TG_WHEN = 'AFTER'
    and TG_TABLE_SCHEMA = 'public' and TG_TABLE_NAME = 'devices'
    and TG_NAME = 'trg_custodial_offline_device_activation_boundary' and TG_NARGS = 0 then
    if TG_RELID = pg_catalog.to_regclass('public.devices')
      and current_user = session_user and current_user = 'supabase_admin'
      and pg_catalog.to_regprocedure('custodial_dr.immutable_import_matches_ordinary_record(oid,anyelement)') is not null then
      if custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) is true then
        return null;
      end if;
    end if;
  end if;
$original_device_restore_branch$;
BEGIN
 SELECT oid INTO owner_oid FROM pg_catalog.pg_roles WHERE rolname='supabase_admin';
 SELECT oid INTO postgres_oid FROM pg_catalog.pg_roles WHERE rolname='postgres';
 original_oid:=pg_catalog.to_regprocedure('public.custodial_record_offline_authority_activation_boundary()');
 helper_oid:=pg_catalog.to_regprocedure('custodial_dr.immutable_import_matches_ordinary_record(oid,anyelement)');
 device_oid:=pg_catalog.to_regclass('public.devices');
 IF current_user IS DISTINCT FROM session_user OR current_user<>'supabase_admin'
  OR owner_oid IS NULL OR postgres_oid IS NULL OR original_oid IS NULL OR helper_oid IS NULL OR device_oid IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=device_oid
    AND c.relowner=owner_oid AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition)
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=helper_oid
    AND p.proowner=owner_oid AND NOT p.prosecdef AND p.prokind='f'
    AND p.prorettype='pg_catalog.bool'::regtype AND NOT p.proretset AND p.pronargs=2)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original device restore owner/relation/invoker matcher unavailable'; END IF;
 -- Names/hashes do not grant authority. Require the actual original fence.
 PERFORM custodial_dr.immutable_import_owner_fence();
 LOCK TABLE public.devices IN ACCESS EXCLUSIVE MODE;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid=device_oid AND t.tgname='trg_custodial_offline_device_activation_boundary'
    AND t.tgfoid=original_oid AND t.tgtype=21 AND t.tgenabled='O' AND NOT t.tgisinternal
    AND t.tgqual IS NULL AND t.tgnargs=0 AND pg_catalog.octet_length(t.tgargs)=0
    AND NOT t.tgdeferrable AND NOT t.tginitdeferred
    AND (SELECT pg_catalog.array_agg(a.attname::text ORDER BY a.attname)
      FROM pg_catalog.unnest(t.tgattr::smallint[]) number(attnum)
      JOIN pg_catalog.pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=number.attnum)=ARRAY['active']::text[])
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Exact original device activation trigger differs'; END IF;
 SELECT * INTO STRICT original FROM pg_catalog.pg_proc WHERE oid=original_oid;
 before_definition:=pg_catalog.pg_get_functiondef(original_oid);
 IF original.proowner<>owner_oid OR original.prokind<>'f' OR original.pronargs<>0 OR original.proretset
  OR original.prorettype<>'pg_catalog.trigger'::regtype OR NOT original.prosecdef
  OR before_definition IS DISTINCT FROM pg_catalog.substr(expected_before_definition,2)
  OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(before_definition,'UTF8'),'sha256'),'hex')
    IS DISTINCT FROM '011cc5921cefe8714f52b821b915686359ac5edb873abd33fec8696cc050f19a'
  OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(original.prosrc,'UTF8'),'sha256'),'hex')
    IS DISTINCT FROM '78ca52bb75851e47e110a3674c744210fec37c0b9c000c2416d3ddf9e785bf05'
  OR (pg_catalog.length(original.prosrc)-pg_catalog.length(pg_catalog.replace(original.prosrc,insertion_point,'')))
    <>pg_catalog.length(insertion_point)
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Exact original device activation function predecessor differs'; END IF;
 -- Captured schema ACL: EXECUTE only original owner and postgres, without
 -- grant option. Preserve the actual ACL/order and every other pg_proc field.
 IF (SELECT count(*) FROM pg_catalog.aclexplode(coalesce(original.proacl,pg_catalog.acldefault('f',owner_oid))))<>2
  OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(original.proacl,pg_catalog.acldefault('f',owner_oid))) a
    WHERE a.grantee NOT IN(owner_oid,postgres_oid) OR a.grantor<>owner_oid OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(original.proacl) a WHERE a.grantee=owner_oid)
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(original.proacl) a WHERE a.grantee=postgres_oid)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original device activation function ACL differs'; END IF;
 after_body:=pg_catalog.replace(original.prosrc,insertion_point,insertion_point||restore_branch);
 after_definition:=pg_catalog.replace(before_definition,insertion_point,insertion_point||restore_branch);
 IF pg_catalog.encode(extensions.digest(pg_catalog.convert_to(after_body,'UTF8'),'sha256'),'hex')
    IS DISTINCT FROM 'd97b5d02b929cd6c744fb73953458fedefeebd09d2026a0fbf28196007476fa2'
  OR pg_catalog.encode(extensions.digest(pg_catalog.convert_to(after_definition,'UTF8'),'sha256'),'hex')
    IS DISTINCT FROM '14bde0e8c994bf8b0cb325fe39c6f60dd8531944a8cc766faf921ec2540449be'
 THEN RAISE EXCEPTION 'Source-derived device activation branch differs'; END IF;
 PERFORM custodial_dr.immutable_import_owner_fence();
 SELECT * INTO STRICT observed FROM pg_catalog.pg_proc WHERE oid=original_oid;
 IF pg_catalog.to_jsonb(observed) IS DISTINCT FROM pg_catalog.to_jsonb(original)
  OR pg_catalog.pg_get_functiondef(original_oid) IS DISTINCT FROM before_definition
 THEN RAISE EXCEPTION 'Original device activation function changed before replacement'; END IF;
 -- Exactly one original function is replaced; no OWNER/ACL/trigger DDL.
 EXECUTE after_definition;
 SELECT * INTO STRICT observed FROM pg_catalog.pg_proc WHERE oid=original_oid;
 IF observed.prosrc IS DISTINCT FROM after_body
  OR pg_catalog.pg_get_functiondef(original_oid) IS DISTINCT FROM after_definition
  OR pg_catalog.to_jsonb(observed)-'prosrc' IS DISTINCT FROM pg_catalog.to_jsonb(original)-'prosrc'
 THEN RAISE EXCEPTION 'Device activation restore changed attributes outside the closed branch'; END IF;
 PERFORM custodial_dr.immutable_import_owner_fence();
END;
$immutable_original_device_boundary$;
COMMIT;
