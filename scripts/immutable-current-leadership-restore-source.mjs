// Fixed offline Source composition. Normal enrollment generation checks remain
// byte-identical outside the existing authenticated original-row import.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
export const leadershipRestoreIdentity='custodial_leadership_private.bind_registration_generation()';
const predecessor='bba5695c6fa448e5462d173a690b591d80783f79295e2e8084ab2f2637e83f0d';
const branch=` -- Retain an exact authenticated archived registration, not a new enrollment.
 IF TG_OP='INSERT' AND TG_LEVEL='ROW' AND TG_WHEN='BEFORE' AND TG_NARGS=0
  AND TG_TABLE_SCHEMA='custodial_leadership_private' AND TG_TABLE_NAME='registrations' THEN
  IF TG_RELID=pg_catalog.to_regclass('custodial_leadership_private.registrations')
   AND current_user=session_user AND current_user='postgres' THEN
   IF custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) IS TRUE
    THEN RETURN NEW; END IF;
  END IF;
 END IF;
`;
export function currentLeadershipRestoreRecipe(){
 assert.equal(arguments.length,0);
 const source=readFileSync(new URL('../release/installed-source/20261031225210_custodial_sealed_repairs_current_eight.sql',import.meta.url),'utf8');
 assert.equal(sha(source),'f4e3dc5be9a465e2099bd9b23488f99b3f9e4c1d9d969844b2fa06b1fbdc7a73');
 const marker='CREATE FUNCTION '+leadershipRestoreIdentity+'\n';assert.equal(source.split(marker).length,2);
 const at=source.indexOf(marker),start=source.indexOf('AS $bind$',at)+'AS $bind$'.length,end=source.indexOf('$bind$;',start);assert.ok(start>at&&end>start);
 const original=source.slice(start,end),before='CREATE OR REPLACE FUNCTION '+leadershipRestoreIdentity+"\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public'\nAS $function$"+original+'$function$\n';
 assert.equal(sha(before),'2274e981ae866ead8a84578a0469474524b0b83b405e8885c559dfd17fd9e435');
 assert.equal(original.split('\nBEGIN\n').length,2);
 const afterBody=original.replace('\nBEGIN\n',()=> '\nBEGIN\n'+branch),after=before.replace('\nBEGIN\n',()=> '\nBEGIN\n'+branch);
 assert.equal(after.replace(branch,''),before);
 return Object.freeze({identity:leadershipRestoreIdentity,registry_identity:leadershipRestoreIdentity,before,after,
  beforeHash:sha(before),afterHash:sha(after),beforeBodyHash:sha(original),afterBodyHash:sha(afterBody)});
}
function parts(){
 const r=currentLeadershipRestoreRecipe();
 const guard=`     -- One exact registered generation guard, with its original-row branch.
     AND NOT (current_user=session_user AND session_user='postgres'
      AND guard_relation_namespace.nspname='custodial_leadership_private' AND guard_relation.relname='registrations'
      AND t.tgname='custodial_leadership_registration_generation' AND t.tgtype=7 AND t.tgenabled='O'
      AND NOT t.tgisinternal AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND t.tgqual IS NULL AND t.tgnargs=0 AND octet_length(t.tgargs)=0 AND t.tgattr=''::int2vector
      AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
      AND t.tgfoid=to_regprocedure('custodial_leadership_private.bind_registration_generation()')
      AND guard_function.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
      AND public.static_weekly_digest_text(pg_get_functiondef(guard_function.oid))='${r.afterHash}'
      AND EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory leadership_inventory
       WHERE leadership_inventory.object_kind='function'
        AND leadership_inventory.object_identity='custodial_leadership_private.bind_registration_generation()'
        AND leadership_inventory.definition_sql=pg_get_functiondef(guard_function.oid)
        AND leadership_inventory.definition_sha256='${r.afterHash}'))
`;
 const install=`
-- Current Source integration only; no role, ACL, trigger, registration or generation write.
DO $immutable_current_leadership_original$
DECLARE p constant jsonb:=$current_leadership_profile$${JSON.stringify(r)}$current_leadership_profile$::jsonb;
 original pg_catalog.pg_proc%rowtype;after_row pg_catalog.pg_proc%rowtype;
 original_trigger pg_catalog.pg_trigger%rowtype;after_trigger pg_catalog.pg_trigger%rowtype;
BEGIN
 PERFORM custodial_dr.immutable_import_owner_fence();
 IF current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Exact isolated original registration owner required';END IF;
 LOCK TABLE custodial_leadership_private.registrations IN ACCESS EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM custodial_leadership_private.registrations)
 THEN RAISE EXCEPTION 'Original registration integration requires fresh DATA';END IF;
 SELECT * INTO STRICT original FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(p->>'identity');
 SELECT * INTO STRICT original_trigger FROM pg_catalog.pg_trigger WHERE tgfoid=original.oid;
 IF original.proowner<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
  OR original.prokind<>'f' OR original.pronargs<>0 OR original.proargtypes<>''::oidvector
  OR original.prorettype<>'pg_catalog.trigger'::regtype OR original.proretset OR NOT original.prosecdef
  OR original.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
  OR original.proleakproof OR original.proisstrict OR original.provolatile<>'v' OR original.proparallel<>'u'
  OR pg_get_functiondef(original.oid) IS DISTINCT FROM p->>'before'
  OR public.static_weekly_digest_text(original.prosrc) IS DISTINCT FROM p->>'beforeBodyHash'
  OR original_trigger.tgrelid<>'custodial_leadership_private.registrations'::regclass
  OR original_trigger.tgname<>'custodial_leadership_registration_generation'
  OR original_trigger.tgtype<>7 OR original_trigger.tgenabled<>'O' OR original_trigger.tgisinternal
  OR original_trigger.tgconstraint<>0 OR original_trigger.tgdeferrable OR original_trigger.tginitdeferred
  OR original_trigger.tgqual IS NOT NULL OR original_trigger.tgnargs<>0 OR octet_length(original_trigger.tgargs)<>0
  OR original_trigger.tgattr<>''::int2vector OR original_trigger.tgoldtable IS NOT NULL OR original_trigger.tgnewtable IS NOT NULL
 THEN RAISE EXCEPTION 'Exact original registration Source or consumer differs';END IF;
 EXECUTE p->>'after';
 SELECT * INTO STRICT after_row FROM pg_catalog.pg_proc WHERE oid=original.oid;
 SELECT * INTO STRICT after_trigger FROM pg_catalog.pg_trigger WHERE oid=original_trigger.oid;
 IF pg_get_functiondef(after_row.oid) IS DISTINCT FROM p->>'after'
  OR public.static_weekly_digest_text(after_row.prosrc) IS DISTINCT FROM p->>'afterBodyHash'
  OR to_jsonb(after_row)-'prosrc' IS DISTINCT FROM to_jsonb(original)-'prosrc'
  OR to_jsonb(after_trigger) IS DISTINCT FROM to_jsonb(original_trigger)
 THEN RAISE EXCEPTION 'Original registration metadata changed outside exact branch';END IF;
 PERFORM custodial_dr.immutable_import_owner_fence();
END $immutable_current_leadership_original$;
`;
 return {guard,install};
}
export function extendCurrentLeadershipRestoreSource(sql){
 assert.equal(typeof sql,'string');assert.equal(sha(sql),predecessor);
 const {guard,install}=parts(),anchor='     -- One Source-attested callback; its exact-original branch is installed below.\n';
 assert.equal(sql.split(anchor).length,2);assert.ok(sql.endsWith('COMMIT;\n'));
 const next=sql.replace(anchor,()=>guard+anchor).slice(0,-'COMMIT;\n'.length)+install+'COMMIT;\n';
 assert.equal(removeCurrentLeadershipRestoreSource(next),sql);return next;
}
export function removeCurrentLeadershipRestoreSource(sql){
 const {guard,install}=parts();assert.equal(sql.split(guard).length,2);assert.equal(sql.split(install).length,2);
 const previous=sql.replace(guard,'').replace(install,'');assert.equal(sha(previous),predecessor);return previous;
}
