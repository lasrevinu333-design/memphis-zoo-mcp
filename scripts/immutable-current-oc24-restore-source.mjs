// Fixed offline Source composition. Normal new-completion outcome checks remain
// byte-identical outside the existing authenticated original-row import.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {currentPublicPlanSourceFenceGuards} from './immutable-current-public-plan-fences.mjs';
import {createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
export const oc24RestoreIdentity='public.custodial_oc24_completion_selection_guard()';
const predecessor='435b7b4cd64f81fbc004f42fb1b99800f01ec41f36482c78c004338bcbd20be4';
const branch=` -- Retain an exact authenticated archived completion without treating it as new work.
 IF TG_OP='INSERT' AND TG_LEVEL='ROW' AND TG_WHEN='BEFORE' AND TG_NARGS=0
  AND TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='completion_responses' THEN
  IF TG_RELID=pg_catalog.to_regclass('public.completion_responses')
   AND current_user=session_user AND current_user='postgres' THEN
   IF custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) IS TRUE
    THEN RETURN NEW; END IF;
  END IF;
 END IF;
`;
export function currentOc24RestoreRecipe(){
 assert.equal(arguments.length,0);
 const source=readFileSync(new URL('../release/installed-source/20260925020244_oc24_bound_legacy_completion_replay.sql',import.meta.url),'utf8');
 assert.equal(sha(source),'a52245120109a50240a02b33de477281c47c389a028580820cdfea4fbcb1194d');
 const marker='create or replace function '+oc24RestoreIdentity+'\n';assert.equal(source.split(marker).length,2);
 const at=source.indexOf(marker),start=source.indexOf('as $fn$',at)+'as $fn$'.length,end=source.indexOf('$fn$;',start);assert.ok(start>at&&end>start);
 const original=source.slice(start,end),before='CREATE OR REPLACE FUNCTION '+oc24RestoreIdentity+"\n RETURNS trigger\n LANGUAGE plpgsql\n SET search_path TO 'pg_catalog', 'public'\nAS $function$"+original+'$function$\n';
 assert.equal(sha(before),'dd1292e978379cf72c2cc2371ab09b1ad279f69b800058aac205807773a6784d');
 assert.equal(original.split('\nbegin\n').length,2);
 const afterBody=original.replace('\nbegin\n',()=> '\nbegin\n'+branch),after=before.replace('\nbegin\n',()=> '\nbegin\n'+branch);
 assert.equal(after.replace(branch,''),before);
 return Object.freeze({identity:oc24RestoreIdentity,registry_identity:oc24RestoreIdentity,before,after,
  beforeHash:sha(before),afterHash:sha(after),beforeBodyHash:sha(original),afterBodyHash:sha(afterBody)});
}
function parts(){
 const r=currentOc24RestoreRecipe();
 const guard=`     -- One exact registered completion-outcome guard, with its original-row branch.
     AND NOT (current_user=session_user AND session_user='postgres'
      AND guard_relation_namespace.nspname='public' AND guard_relation.relname='completion_responses'
      AND t.tgname='trg_oc24_completion_selection' AND t.tgtype=23 AND t.tgenabled='A'
      AND NOT t.tgisinternal AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND t.tgqual IS NULL AND t.tgnargs=0 AND octet_length(t.tgargs)=0 AND t.tgattr::text=(SELECT attnum::text FROM pg_catalog.pg_attribute WHERE attrelid=t.tgrelid AND attname='response_json' AND NOT attisdropped)
      AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
      AND t.tgfoid=to_regprocedure('public.custodial_oc24_completion_selection_guard()')
      AND guard_function.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
      AND public.static_weekly_digest_text(pg_get_functiondef(guard_function.oid))='${r.afterHash}'
      AND EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory oc24_inventory
       WHERE oc24_inventory.object_kind='function'
        AND oc24_inventory.object_identity='public.custodial_oc24_completion_selection_guard()'
        AND oc24_inventory.definition_sql=pg_get_functiondef(guard_function.oid)
        AND oc24_inventory.definition_sha256='${r.afterHash}'))
`+currentPublicPlanSourceFenceGuards();
 const install=`
-- Current Source integration only; no role, ACL, trigger, completion or outcome write.
DO $immutable_current_oc24_original$
DECLARE p constant jsonb:=$current_oc24_profile$${JSON.stringify(r)}$current_oc24_profile$::jsonb;
 original pg_catalog.pg_proc%rowtype;after_row pg_catalog.pg_proc%rowtype;
 original_trigger pg_catalog.pg_trigger%rowtype;after_trigger pg_catalog.pg_trigger%rowtype;
BEGIN
 PERFORM custodial_dr.immutable_import_owner_fence();
 IF current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Exact isolated original completion owner required';END IF;
 LOCK TABLE public.completion_responses IN ACCESS EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM public.completion_responses)
 THEN RAISE EXCEPTION 'Original completion integration requires fresh DATA';END IF;
 SELECT * INTO STRICT original FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(p->>'identity');
 SELECT * INTO STRICT original_trigger FROM pg_catalog.pg_trigger WHERE tgfoid=original.oid;
 IF original.proowner<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
  OR original.prokind<>'f' OR original.pronargs<>0 OR original.proargtypes<>''::oidvector
  OR original.prorettype<>'pg_catalog.trigger'::regtype OR original.proretset OR original.prosecdef
  OR original.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
  OR original.proleakproof OR original.proisstrict OR original.provolatile<>'v' OR original.proparallel<>'u'
  OR pg_get_functiondef(original.oid) IS DISTINCT FROM p->>'before'
  OR public.static_weekly_digest_text(original.prosrc) IS DISTINCT FROM p->>'beforeBodyHash'
  OR original_trigger.tgrelid<>'public.completion_responses'::regclass
  OR original_trigger.tgname<>'trg_oc24_completion_selection'
  OR original_trigger.tgtype<>23 OR original_trigger.tgenabled<>'A' OR original_trigger.tgisinternal
  OR original_trigger.tgconstraint<>0 OR original_trigger.tgdeferrable OR original_trigger.tginitdeferred
  OR original_trigger.tgqual IS NOT NULL OR original_trigger.tgnargs<>0 OR octet_length(original_trigger.tgargs)<>0
  OR original_trigger.tgattr::text IS DISTINCT FROM (SELECT attnum::text FROM pg_catalog.pg_attribute WHERE attrelid=original_trigger.tgrelid AND attname='response_json' AND NOT attisdropped) OR original_trigger.tgoldtable IS NOT NULL OR original_trigger.tgnewtable IS NOT NULL
 THEN RAISE EXCEPTION 'Exact original completion Source or consumer differs';END IF;
 EXECUTE p->>'after';
 SELECT * INTO STRICT after_row FROM pg_catalog.pg_proc WHERE oid=original.oid;
 SELECT * INTO STRICT after_trigger FROM pg_catalog.pg_trigger WHERE oid=original_trigger.oid;
 IF pg_get_functiondef(after_row.oid) IS DISTINCT FROM p->>'after'
  OR public.static_weekly_digest_text(after_row.prosrc) IS DISTINCT FROM p->>'afterBodyHash'
  OR to_jsonb(after_row)-'prosrc' IS DISTINCT FROM to_jsonb(original)-'prosrc'
  OR to_jsonb(after_trigger) IS DISTINCT FROM to_jsonb(original_trigger)
 THEN RAISE EXCEPTION 'Original completion metadata changed outside exact branch';END IF;
 PERFORM custodial_dr.immutable_import_owner_fence();
END $immutable_current_oc24_original$;
`;
 return {guard,install};
}
export function extendCurrentOc24RestoreSource(sql){
 assert.equal(typeof sql,'string');assert.equal(sha(sql),predecessor);
 const {guard,install}=parts(),anchor='     -- Original taxonomy checks still reject inconsistent completion answers.\n';
 assert.equal(sql.split(anchor).length,2);assert.ok(sql.endsWith('COMMIT;\n'));
 const next=sql.replace(anchor,()=>guard+anchor).slice(0,-'COMMIT;\n'.length)+install+'COMMIT;\n';
 assert.equal(removeCurrentOc24RestoreSource(next),sql);return next;
}
export function removeCurrentOc24RestoreSource(sql){
 const {guard,install}=parts();assert.equal(sql.split(guard).length,2);assert.equal(sql.split(install).length,2);
 const previous=sql.replace(guard,'').replace(install,'');assert.equal(sha(previous),predecessor);return previous;
}
