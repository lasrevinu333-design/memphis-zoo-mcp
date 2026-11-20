// One exact unchanged completion validator; validation continues to execute.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {currentManualPlanSourceFenceGuard} from './immutable-current-coverall-restore-source.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
export const taxonomyGuardPredecessorSha='0f1d6c0b25947cdcd187257103ab0693c035fdd2587df5d216d42b8b801691b3';
export const taxonomyGuardClause=`     -- Original taxonomy checks still reject inconsistent completion answers.
     AND NOT (current_user=session_user AND session_user='postgres'
      AND guard_relation_namespace.nspname='public' AND guard_relation.relname='completion_responses'
      AND t.tgname='custodial_completion_taxonomy_response_guard' AND t.tgtype=23 AND t.tgenabled='A'
      AND NOT t.tgisinternal AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND t.tgqual IS NULL AND t.tgnargs=0 AND octet_length(t.tgargs)=0
      AND t.tgattr::text=(SELECT a.attnum::text FROM pg_catalog.pg_attribute a
       WHERE a.attrelid=t.tgrelid AND a.attname='response_json' AND NOT a.attisdropped)
      AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
      AND t.tgfoid=to_regprocedure('public.custodial_completion_taxonomy_response_guard()')
      AND guard_function.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
      AND NOT guard_function.prosecdef
      AND public.static_weekly_digest_text(pg_get_functiondef(guard_function.oid))='e0da75066209d8b7152140baa52845c20e3c71827ce9acc3fda89e979fba758d'
      AND EXISTS(SELECT 1 FROM pg_catalog.pg_proc taxonomy_check
       WHERE taxonomy_check.oid=to_regprocedure('public.custodial_completion_assert_taxonomy(jsonb)')
        AND taxonomy_check.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
        AND taxonomy_check.prosecdef
        AND public.static_weekly_digest_text(pg_get_functiondef(taxonomy_check.oid))='7369d77aaa54ad7d064c02b848d770b6fdf1e6570e8c48a7dd477a0b8bc895a8'))
`;
export const completionSourceFenceClause=`     -- This exact original completion-source lock still executes unchanged.
     AND NOT (current_user=session_user AND session_user='postgres'
      AND guard_relation_namespace.nspname='public' AND guard_relation.relname='completion_responses'
      AND t.tgname='custodial_recurring_notification_plan_source_fence' AND t.tgtype=62 AND t.tgenabled='A'
      AND NOT t.tgisinternal AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND t.tgqual IS NULL AND t.tgnargs=0 AND octet_length(t.tgargs)=0 AND t.tgattr=''::int2vector
      AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
      AND t.tgfoid=to_regprocedure('public.static_weekly_v27_notification_plan_source_write_fence()')
      AND guard_function.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
      AND guard_function.prosecdef
      AND public.static_weekly_digest_text(pg_get_functiondef(guard_function.oid))='4fc0ef22db650c17c5d98a35ef62ba165c6fe7301408bd9aab454e875a724fff')
`;
export function verifyOriginalTaxonomySource(){
 const source=readFileSync(new URL('../release/installed-source/20261003120000_completion_taxonomy_evidence.sql',import.meta.url),'utf8');
 assert.equal(sha(source),'a732bcd9077aa98b263a39e7ce29edd61a084db843c0ef02b84f6c2cd78890bf');
 for(const [identity,header,expected] of [
  ['custodial_completion_assert_taxonomy(p_response jsonb)'," RETURNS void\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public'\n",'7369d77aaa54ad7d064c02b848d770b6fdf1e6570e8c48a7dd477a0b8bc895a8'],
  ['custodial_completion_taxonomy_response_guard()'," RETURNS trigger\n LANGUAGE plpgsql\n SET search_path TO 'pg_catalog', 'public'\n",'e0da75066209d8b7152140baa52845c20e3c71827ce9acc3fda89e979fba758d'],
 ]){
  const marker='create function public.'+identity;assert.equal(source.split(marker).length,2);
  const at=source.indexOf(marker),start=source.indexOf('as $fn$',at)+'as $fn$'.length,end=source.indexOf('$fn$;',start);assert.ok(start>at&&end>start);
  const definition='CREATE OR REPLACE FUNCTION public.'+identity+'\n'+header+'AS $function$'+source.slice(start,end)+'$function$\n';assert.equal(sha(definition),expected);
 }
 // Existing fixed helper authenticates the same complete retained fence body.
 currentManualPlanSourceFenceGuard();
 const fenceSource=readFileSync(new URL('../release/installed-source/20261022071830_recurring_normal_notification_plan.sql',import.meta.url),'utf8');
 assert.equal(sha(fenceSource),'f3083dba31b1973cd42692362ceda5e4c08d505c063ceb505c75214dd4e16c95');
 assert.ok(fenceSource.includes("foreach name in array array['public.completion_responses',"));
 assert.ok(fenceSource.includes("execute format('create trigger custodial_recurring_notification_plan_source_fence before insert or update or delete or truncate on %s for each statement execute function public.static_weekly_v27_notification_plan_source_write_fence()',name);"));
 return true;
}
export function extendCurrentTaxonomyGuard(sql){
 assert.equal(typeof sql,'string');assert.equal(sha(sql),taxonomyGuardPredecessorSha);verifyOriginalTaxonomySource();
 const anchor='     -- One exact registered generation guard, with its original-row branch.\n';assert.equal(sql.split(anchor).length,2);
 const next=sql.replace(anchor,()=>taxonomyGuardClause+completionSourceFenceClause+anchor);assert.equal(removeCurrentTaxonomyGuard(next),sql);return next;
}
export function removeCurrentTaxonomyGuard(sql){
 assert.equal(typeof sql,'string');assert.equal(sql.split(taxonomyGuardClause).length,2);
 assert.equal(sql.split(completionSourceFenceClause).length,2);
 const previous=sql.replace(taxonomyGuardClause,'').replace(completionSourceFenceClause,'');assert.equal(sha(previous),taxonomyGuardPredecessorSha);return previous;
}
