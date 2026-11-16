// Fixed offline Source composition. Normal operational coverage rules remain
// byte-identical outside the existing authenticated original-row import.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
export const restrictedCoverageRestoreIdentity='public.sch_guard_restricted_coverage_template()';
const predecessor='fd0a7af46cddd57f149bfa880fca0ee7c763f2c7bed3278ebfe5759ad56971f6';
const branch=` -- Retain an exact archived coverage template without re-running restriction normalization.
 IF TG_OP='INSERT' AND TG_LEVEL='ROW' AND TG_WHEN='BEFORE' AND TG_NARGS=0
  AND TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='coverage_templates' THEN
  IF TG_RELID=pg_catalog.to_regclass('public.coverage_templates')
   AND current_user=session_user AND current_user='postgres' THEN
   IF custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) IS TRUE
    THEN RETURN NEW; END IF;
  END IF;
 END IF;
`;
export function currentRestrictedCoverageRestoreRecipe(){
 assert.equal(arguments.length,0);
 const source=readFileSync(new URL('../supabase/migrations/00000000000000_production_baseline.sql',import.meta.url),'utf8');
 assert.equal(sha(source),'decf8dcdceb1f722ec966d16addd8c47d7ceaca9a21f1464a26bf8cbfee7d7fb');
 const marker='CREATE OR REPLACE FUNCTION '+restrictedCoverageRestoreIdentity+'\n';assert.equal(source.split(marker).length,2);
 const at=source.indexOf(marker),start=source.indexOf('AS $function$',at)+'AS $function$'.length,end=source.indexOf('$function$;',start);assert.ok(start>at&&end>start);
 const original=source.slice(start,end),before=source.slice(at,end+'$function$'.length)+'\n';
 assert.equal(sha(before),'a8086783229d8bb2bbc9ab13ca56f9de3feef9600487fdb10061a61804b82a9f');
 assert.equal(original.split('\nbegin\n').length,2);
 const afterBody=original.replace('\nbegin\n',()=> '\nbegin\n'+branch),after=before.replace('\nbegin\n',()=> '\nbegin\n'+branch);
 assert.equal(after.replace(branch,''),before);
 return Object.freeze({identity:restrictedCoverageRestoreIdentity,registry_identity:'sch_guard_restricted_coverage_template()',before,after,
  beforeHash:sha(before),afterHash:sha(after),beforeBodyHash:sha(original),afterBodyHash:sha(afterBody)});
}
function parts(){
 const r=currentRestrictedCoverageRestoreRecipe();
 const guard=`     -- One exact registered coverage-outcome guard, with its original-row branch.
     AND NOT (current_user=session_user AND session_user='postgres'
      AND guard_relation_namespace.nspname='public' AND guard_relation.relname='coverage_templates'
      AND t.tgname='trg_sch_guard_restricted_coverage_template' AND t.tgtype=23 AND t.tgenabled='O'
      AND NOT t.tgisinternal AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND t.tgqual IS NULL AND t.tgnargs=0 AND octet_length(t.tgargs)=0 AND t.tgattr::text=(SELECT string_agg(a.attnum::text,' ' ORDER BY c.ordinal) FROM unnest(ARRAY['location_group_id','day_of_week','assigned_employee_id']::text[]) WITH ORDINALITY c(name,ordinal) JOIN pg_catalog.pg_attribute a ON a.attrelid=t.tgrelid AND a.attname=c.name AND NOT a.attisdropped HAVING count(*)=3)
      AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
      AND t.tgfoid=to_regprocedure('public.sch_guard_restricted_coverage_template()')
      AND guard_function.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
      AND public.static_weekly_digest_text(pg_get_functiondef(guard_function.oid))='${r.afterHash}'
      AND EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory restricted_coverage_inventory
       WHERE restricted_coverage_inventory.object_kind='function'
        AND restricted_coverage_inventory.object_identity='sch_guard_restricted_coverage_template()'
        AND restricted_coverage_inventory.definition_sql=pg_get_functiondef(guard_function.oid)
        AND restricted_coverage_inventory.definition_sha256='${r.afterHash}'))
`;
 const install=`
-- Current Source integration only; no role, ACL, trigger, coverage or outcome write.
DO $immutable_current_restricted_coverage_original$
DECLARE p constant jsonb:=$current_restricted_coverage_profile$${JSON.stringify(r)}$current_restricted_coverage_profile$::jsonb;
 original pg_catalog.pg_proc%rowtype;after_row pg_catalog.pg_proc%rowtype;
 original_trigger pg_catalog.pg_trigger%rowtype;after_trigger pg_catalog.pg_trigger%rowtype;
BEGIN
 PERFORM custodial_dr.immutable_import_owner_fence();
 IF current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Exact isolated original coverage owner required';END IF;
 LOCK TABLE public.coverage_templates IN ACCESS EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM public.coverage_templates)
 THEN RAISE EXCEPTION 'Original coverage integration requires fresh DATA';END IF;
 SELECT * INTO STRICT original FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(p->>'identity');
 SELECT * INTO STRICT original_trigger FROM pg_catalog.pg_trigger WHERE tgfoid=original.oid;
 IF original.proowner<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
  OR original.prokind<>'f' OR original.pronargs<>0 OR original.proargtypes<>''::oidvector
  OR original.prorettype<>'pg_catalog.trigger'::regtype OR original.proretset OR original.prosecdef
  OR original.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
  OR original.proleakproof OR original.proisstrict OR original.provolatile<>'v' OR original.proparallel<>'u'
  OR pg_get_functiondef(original.oid) IS DISTINCT FROM p->>'before'
  OR public.static_weekly_digest_text(original.prosrc) IS DISTINCT FROM p->>'beforeBodyHash'
  OR original_trigger.tgrelid<>'public.coverage_templates'::regclass
  OR original_trigger.tgname<>'trg_sch_guard_restricted_coverage_template'
  OR original_trigger.tgtype<>23 OR original_trigger.tgenabled<>'O' OR original_trigger.tgisinternal
  OR original_trigger.tgconstraint<>0 OR original_trigger.tgdeferrable OR original_trigger.tginitdeferred
  OR original_trigger.tgqual IS NOT NULL OR original_trigger.tgnargs<>0 OR octet_length(original_trigger.tgargs)<>0
  OR original_trigger.tgattr::text IS DISTINCT FROM (SELECT string_agg(a.attnum::text,' ' ORDER BY c.ordinal) FROM unnest(ARRAY['location_group_id','day_of_week','assigned_employee_id']::text[]) WITH ORDINALITY c(name,ordinal) JOIN pg_catalog.pg_attribute a ON a.attrelid=original_trigger.tgrelid AND a.attname=c.name AND NOT a.attisdropped HAVING count(*)=3) OR original_trigger.tgoldtable IS NOT NULL OR original_trigger.tgnewtable IS NOT NULL
 THEN RAISE EXCEPTION 'Exact original coverage Source or consumer differs';END IF;
 EXECUTE p->>'after';
 SELECT * INTO STRICT after_row FROM pg_catalog.pg_proc WHERE oid=original.oid;
 SELECT * INTO STRICT after_trigger FROM pg_catalog.pg_trigger WHERE oid=original_trigger.oid;
 IF pg_get_functiondef(after_row.oid) IS DISTINCT FROM p->>'after'
  OR public.static_weekly_digest_text(after_row.prosrc) IS DISTINCT FROM p->>'afterBodyHash'
  OR to_jsonb(after_row)-'prosrc' IS DISTINCT FROM to_jsonb(original)-'prosrc'
  OR to_jsonb(after_trigger) IS DISTINCT FROM to_jsonb(original_trigger)
 THEN RAISE EXCEPTION 'Original coverage metadata changed outside exact branch';END IF;
 PERFORM custodial_dr.immutable_import_owner_fence();
END $immutable_current_restricted_coverage_original$;
`;
 return {guard,install};
}
export function extendCurrentRestrictedCoverageRestoreSource(sql){
 assert.equal(typeof sql,'string');assert.equal(sha(sql),predecessor);
 const {guard,install}=parts(),anchor='     -- Original taxonomy checks still reject inconsistent completion answers.\n';
 assert.equal(sql.split(anchor).length,2);assert.ok(sql.endsWith('COMMIT;\n'));
 const next=sql.replace(anchor,()=>guard+anchor).slice(0,-'COMMIT;\n'.length)+install+'COMMIT;\n';
 assert.equal(removeCurrentRestrictedCoverageRestoreSource(next),sql);return next;
}
export function removeCurrentRestrictedCoverageRestoreSource(sql){
 const {guard,install}=parts();assert.equal(sql.split(guard).length,2);assert.equal(sql.split(install).length,2);
 const previous=sql.replace(guard,'').replace(install,'');assert.equal(sha(previous),predecessor);return previous;
}
