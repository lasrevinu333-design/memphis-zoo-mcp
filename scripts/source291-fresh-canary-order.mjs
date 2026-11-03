import {createHash} from 'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
const SOURCE='19e55cfdc9f1ddfd34c2912892ac23979ad5fc44a45da7e444a008b1da0a8c9b';
const BEFORE='9bf59d727808a52c67a3f9be5223b3f0996219af738ddc8421125e7391540027';
const EXPECTED='6df9122356e7efbfce635c423fdbca00f419ef4eafbedc8b4fb9e5a0550a39e7';
function pieces(text){
 const tuples=[],outside=[];
 for(const line of text.split('\n')){
  if(/^\s*\('(?:[^']|'')*','(?:[^']|'')*','(?:[^']|'')*'\),?\s*$/.test(line))tuples.push(line.trim().replace(/,$/,''));
  else if(line.trim())outside.push(line);
 }
 return {tuples:tuples.sort(),outside};
}
/** Formatting-equivalent fresh reconstruction only. The original source292
 * literal is the authority; observed text must contain exactly the same SQL
 * VALUES tuples, outside SQL and function attributes. No fact/identity/purpose,
 * grant, health predicate or historical migration guard is substituted.
 */
export function source291FreshCanarySql(sourceBytes,observedText){
 if(sha(sourceBytes)!==SOURCE||![BEFORE,EXPECTED].includes(sha(observedText)))throw Error('Exact source292 and observed fresh Source291 preimage required');
 const marker='$EXACT_SOURCE291_CANARY_PREIMAGE$',parts=sourceBytes.toString().split(marker);
 if(parts.length!==3||sha(parts[1])!==EXPECTED)throw Error('Original source292 predecessor literal changed');
 const expected=parts[1],before=pieces(observedText),after=pieces(expected);
 if(before.tuples.length<600||JSON.stringify(before)!==JSON.stringify(after))throw Error('Canary facts or SQL semantics differ; no order-only repair');
 const delimiter='$CUSTODIAL_FRESH_SOURCE291_ORDER_19e55$';
 if(expected.includes(delimiter))throw Error('Unexpected delimiter');
 return `-- Original Source292 literal, identical complete canary tuple multiset.
-- Only existing VALUES block order/format and its saved definition are aligned.
-- This is local fresh reconstruction, not production/recovery admission.
BEGIN;
SET LOCAL search_path=pg_catalog,public,extensions;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $fresh$ BEGIN
 IF current_user<>'supabase_admin' OR session_user<>'supabase_admin'
 OR NOT(SELECT rolsuper FROM pg_roles WHERE rolname=current_user)
 OR current_setting('listen_addresses')<>'' OR current_setting('cron.launch_active_jobs')<>'off'
 THEN RAISE EXCEPTION 'Owned isolated fresh fixture required';END IF;
END $fresh$;
LOCK TABLE public.custodial_release_authority_restore_inventory IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE source291_inventory_before ON COMMIT DROP AS TABLE public.custodial_release_authority_restore_inventory;
CREATE TEMP TABLE source291_proc_before ON COMMIT DROP AS
 SELECT proowner,proacl,proconfig,prolang,provolatile,proparallel,proisstrict,prosecdef,proleakproof,prokind,prorettype,proretset,proargtypes,proallargtypes,proargmodes,proargnames
 FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure;
DO $exact_order$ DECLARE body text;selected_id uuid;BEGIN
 body:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 IF public.static_weekly_digest_text(body) NOT IN('${BEFORE}','${EXPECTED}')
 OR (SELECT count(*) FROM source291_inventory_before)<>7312
 OR EXISTS(SELECT 1 FROM source291_inventory_before WHERE definition_sha256<>public.static_weekly_digest_text(definition_sql))
 OR (SELECT count(*) FROM source291_inventory_before WHERE object_kind='function'
  AND object_identity LIKE '%(%' AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure
  AND definition_sql=body AND definition_sha256=public.static_weekly_digest_text(body))<>1
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass
  AND tgname='trg_custodial_release_authority_restore_inventory_immutable' AND tgenabled='A')
 OR EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  WHERE d.defaclnamespace IN(0,'public'::regnamespace) AND d.defaclobjtype IN('r','S')
   AND a.grantee IN(0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole))
 THEN RAISE EXCEPTION 'Exact fresh Source291 and original ALWAYS recovery guard required';END IF;
 IF public.static_weekly_digest_text(body)='${EXPECTED}' THEN RETURN;END IF;
 SELECT inventory_id INTO STRICT selected_id FROM source291_inventory_before
 WHERE object_kind='function' AND object_identity LIKE '%(%'
  AND to_regprocedure(object_identity)='public.custodial_release_canary_authority_surface()'::regprocedure;
 EXECUTE ${delimiter}${expected}${delimiter};
 body:=pg_get_functiondef('public.custodial_release_canary_authority_surface()'::regprocedure);
 IF public.static_weekly_digest_text(body)<>'${EXPECTED}'
 OR EXISTS((SELECT * FROM source291_proc_before) EXCEPT
  (SELECT proowner,proacl,proconfig,prolang,provolatile,proparallel,proisstrict,prosecdef,proleakproof,prokind,prorettype,proretset,proargtypes,proallargtypes,proargmodes,proargnames FROM pg_proc WHERE oid='public.custodial_release_canary_authority_surface()'::regprocedure))
 THEN RAISE EXCEPTION 'Source291 original literal or function authority attributes changed';END IF;
 ALTER TABLE public.custodial_release_authority_restore_inventory DISABLE TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 UPDATE public.custodial_release_authority_restore_inventory SET definition_sql=body,definition_sha256='${EXPECTED}'
 WHERE inventory_id=selected_id AND definition_sha256='${BEFORE}';
 IF NOT FOUND THEN RAISE EXCEPTION 'Exact saved original canary changed';END IF;
 ALTER TABLE public.custodial_release_authority_restore_inventory ENABLE ALWAYS TRIGGER trg_custodial_release_authority_restore_inventory_immutable;
 IF EXISTS((SELECT * FROM source291_inventory_before WHERE inventory_id<>selected_id)
  EXCEPT (SELECT * FROM public.custodial_release_authority_restore_inventory WHERE inventory_id<>selected_id))
 OR EXISTS((SELECT * FROM public.custodial_release_authority_restore_inventory WHERE inventory_id<>selected_id)
  EXCEPT (SELECT * FROM source291_inventory_before WHERE inventory_id<>selected_id))
 OR EXISTS((SELECT inventory_id,restore_order,object_kind,object_identity,captured_at FROM source291_inventory_before)
  EXCEPT(SELECT inventory_id,restore_order,object_kind,object_identity,captured_at FROM public.custodial_release_authority_restore_inventory))
 OR (SELECT count(*) FROM public.custodial_release_authority_restore_inventory)<>7312
 THEN RAISE EXCEPTION 'Unrelated original recovery records changed';END IF;
END $exact_order$;
COMMIT;
`;
}
