// Closed original read-only separation validator. It continues to execute;
// no original-row bypass, new recipe, changed function, or disabled trigger.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
const predecessor='fdb0ac3121031fc50450588730950d80d69941ce506694a519d5ee81683c0f58';
export const separationGuardClause=`     -- These two original separation validators still execute unchanged.
     AND NOT (current_user=session_user AND session_user='postgres'
      AND guard_relation_namespace.nspname='public'
      AND ((guard_relation.relname='sessions' AND t.tgname='trg_custodial_v12_session_separation_fence')
       OR (guard_relation.relname='custodial_offline_actor_contexts' AND t.tgname='trg_custodial_v12_offline_separation_fence'))
      AND t.tgtype=7 AND t.tgenabled='O'
      AND NOT t.tgisinternal AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND t.tgqual IS NULL AND t.tgnargs=0 AND octet_length(t.tgargs)=0 AND t.tgattr=''::int2vector
      AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
      AND t.tgfoid=to_regprocedure('public.custodial_v12_reject_post_separation_start()')
      AND guard_function.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
      AND guard_function.prosecdef
      AND public.static_weekly_digest_text(pg_get_functiondef(guard_function.oid))='0e37d1004b44dd283556e665002a917a6a7f525cdf70851303c9510220d3272d')
`;
export function verifyOriginalSeparationGuardSource(){
 const source=readFileSync(new URL('../supabase/migrations/20260926143542_static_weekly_protected_separation.sql',import.meta.url),'utf8');
 assert.equal(sha(source),'5a9123649c92635091854a66ad06404a5dcbc8a6b0b63b7b8b0dd8894de58032');
 const marker='create function public.custodial_v12_reject_post_separation_start()';assert.equal(source.split(marker).length,2);
 const at=source.indexOf(marker),start=source.indexOf('as $function$',at)+'as $function$'.length,end=source.indexOf('$function$;',start);assert.ok(start>at&&end>start);
 const definition="CREATE OR REPLACE FUNCTION public.custodial_v12_reject_post_separation_start()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public'\nAS $function$"+source.slice(start,end)+'$function$\n';
 assert.equal(sha(definition),'0e37d1004b44dd283556e665002a917a6a7f525cdf70851303c9510220d3272d');
 for(const [trigger,table] of [['trg_custodial_v12_session_separation_fence','sessions'],['trg_custodial_v12_offline_separation_fence','custodial_offline_actor_contexts']])
  assert.ok(source.includes(`create trigger ${trigger}\n  before insert on public.${table} for each row\n  execute function public.custodial_v12_reject_post_separation_start();`));
 return definition;
}
export function extendCurrentSeparationGuard(sql){
 assert.equal(sha(sql),predecessor);verifyOriginalSeparationGuardSource();
 const anchor='     -- Original taxonomy checks still reject inconsistent completion answers.\n';assert.equal(sql.split(anchor).length,2);
 const next=sql.replace(anchor,()=>separationGuardClause+anchor);assert.equal(removeCurrentSeparationGuard(next),sql);return next;
}
export function removeCurrentSeparationGuard(sql){
 assert.equal(sql.split(separationGuardClause).length,2);const prior=sql.replace(separationGuardClause,'');assert.equal(sha(prior),predecessor);return prior;
}
