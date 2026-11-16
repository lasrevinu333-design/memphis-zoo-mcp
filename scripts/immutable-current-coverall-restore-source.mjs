// Offline, fixed Source composition for one original-row callback. No database
// connection or caller-selected definition/role/predicate is accepted.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
export const coverallRestoreIdentity='custodial_coverall.bind_manual_delivery_after_acceptance()';
const predecessor='90569992129c2f6beebca17be3ade0296182322577c63094cdb6b54b9bb670a8';
const branch=` -- Only the actual single/set writer's exact authenticated archived row.
 IF TG_OP='INSERT' AND TG_LEVEL='ROW' AND TG_WHEN='AFTER' AND TG_NARGS=0
  AND TG_TABLE_SCHEMA='custodial_coverall' AND TG_TABLE_NAME='activation_receipts'
 THEN
  IF TG_RELID=pg_catalog.to_regclass('custodial_coverall.activation_receipts')
   AND current_user=session_user AND current_user='postgres' THEN
   IF custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) IS TRUE
    THEN RETURN NEW; END IF;
  END IF;
 END IF;
`;
export function currentCoverallRestoreRecipe(){
 assert.equal(arguments.length,0);
 const source=readFileSync(new URL('../release/installed-source/20261031125902_approved_manual_native_operations.sql',import.meta.url),'utf8');
 assert.equal(sha(source),'10238c293dda15a52321fa670f3763dd772ab6d976665cf306f737c613696b6d');
 const marker='CREATE FUNCTION '+coverallRestoreIdentity+'\n';assert.equal(source.split(marker).length,2);
 const at=source.indexOf(marker),start=source.indexOf('AS $accepted$',at)+'AS $accepted$'.length,end=source.indexOf('$accepted$;',start);
 assert.ok(start>at&&end>start);
 const original=source.slice(start,end),before='CREATE OR REPLACE FUNCTION '+coverallRestoreIdentity+"\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public'\nAS $function$"+original+'$function$\n';
 assert.equal(sha(before),'716454f3b23c064fa54b2c7ea64fcb906ab3954d127e181aa794fd5829f06b7c');
 assert.equal(original.split('\nBEGIN\n').length,2);
 const afterBody=original.replace('\nBEGIN\n',()=> '\nBEGIN\n'+branch),after=before.replace('\nBEGIN\n',()=> '\nBEGIN\n'+branch);
 assert.equal(after.replace(branch,''),before);assert.equal(afterBody.replace(branch,''),original);
 return Object.freeze({identity:coverallRestoreIdentity,registry_identity:coverallRestoreIdentity,before,after,
  beforeHash:sha(before),afterHash:sha(after),beforeBodyHash:sha(original),afterBodyHash:sha(afterBody)});
}
export function currentManualPlanSourceFenceGuard(){
 assert.equal(arguments.length,0);
 const source=readFileSync(new URL('../release/installed-source/20261022071830_recurring_normal_notification_plan.sql',import.meta.url),'utf8');
 assert.equal(sha(source),'f3083dba31b1973cd42692362ceda5e4c08d505c063ceb505c75214dd4e16c95');
 const marker='create function public.static_weekly_v27_notification_plan_source_write_fence()\n';assert.equal(source.split(marker).length,2);
 const at=source.indexOf(marker),start=source.indexOf('as $fence$',at)+'as $fence$'.length,end=source.indexOf('$fence$;',start);assert.ok(start>at&&end>start);
 const definition="CREATE OR REPLACE FUNCTION public.static_weekly_v27_notification_plan_source_write_fence()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog'\nAS $function$"+source.slice(start,end)+'$function$\n';
 assert.equal(sha(definition),'4fc0ef22db650c17c5d98a35ef62ba165c6fe7301408bd9aab454e875a724fff');
 // currentCoverallRestoreRecipe also authenticates the complete installation
 // Source declaring the three-table loop and fourth lunch-proof consumer.
 currentCoverallRestoreRecipe();
 return `     -- Exact four retained manual-plan source fences still take their shared lock.
     AND NOT EXISTS(
      SELECT 1 FROM (VALUES
       ('manual_application_bindings','custodial_manual_notification_plan_source_fence'),
       ('manual_application_intents','custodial_manual_notification_plan_source_fence'),
       ('manual_application_receipts','custodial_manual_notification_plan_source_fence'),
       ('manual_lunch_admission_proofs','manual_lunch_proof_source_fence')
      ) manual_fence(table_name,trigger_name)
      WHERE current_user=session_user AND session_user='postgres'
       AND guard_relation_namespace.nspname='custodial_coverall' AND guard_relation.relname=manual_fence.table_name
       AND item->>'schema_name'='custodial_coverall' AND item->>'table_name'=manual_fence.table_name
       AND t.tgname=manual_fence.trigger_name AND t.tgtype=62 AND t.tgenabled='A'
       AND NOT t.tgisinternal AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
       AND t.tgqual IS NULL AND t.tgnargs=0 AND octet_length(t.tgargs)=0 AND t.tgattr=''::int2vector
       AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
       AND t.tgfoid=to_regprocedure('public.static_weekly_v27_notification_plan_source_write_fence()')
       AND guard_function.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
       AND public.static_weekly_digest_text(pg_get_functiondef(guard_function.oid))='4fc0ef22db650c17c5d98a35ef62ba165c6fe7301408bd9aab454e875a724fff')
`;
}
function parts(){
 const r=currentCoverallRestoreRecipe();
 const callbackGuard=`     -- One Source-attested callback; its exact-original branch is installed below.
     AND NOT (current_user=session_user AND session_user='postgres'
      AND guard_relation_namespace.nspname='custodial_coverall' AND guard_relation.relname='activation_receipts'
      AND t.tgname='manual_operational_delivery_complete' AND t.tgtype=5 AND t.tgenabled='O'
      AND NOT t.tgisinternal AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND t.tgqual IS NULL AND t.tgnargs=0 AND octet_length(t.tgargs)=0 AND t.tgattr=''::int2vector
      AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
      AND t.tgfoid=to_regprocedure('custodial_coverall.bind_manual_delivery_after_acceptance()')
      AND guard_function.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
      AND public.static_weekly_digest_text(pg_get_functiondef(guard_function.oid))='${r.afterHash}')
`;
 const guard=callbackGuard+currentManualPlanSourceFenceGuard();
 const install=`
-- Exact current Source-only callback integration, before original import seals
-- its full target shape. Both original trigger consumers/ACLs remain intact.
DO $immutable_current_coverall_original$
DECLARE p constant jsonb:=$current_coverall_profile$${JSON.stringify(r)}$current_coverall_profile$::jsonb;
 original pg_catalog.pg_proc%rowtype;after_row pg_catalog.pg_proc%rowtype;
 original_triggers jsonb;after_triggers jsonb;
BEGIN
 PERFORM custodial_dr.immutable_import_owner_fence();
 IF current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Exact isolated original callback owner required';END IF;
 LOCK TABLE custodial_coverall.activation_receipts,public.static_weekly_approved_initial_confirmations IN ACCESS EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM custodial_coverall.activation_receipts)
  OR EXISTS(SELECT 1 FROM public.static_weekly_approved_initial_confirmations)
 THEN RAISE EXCEPTION 'Original callback integration requires fresh DATA';END IF;
 SELECT * INTO STRICT original FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(p->>'identity');
 IF original.proowner<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
  OR original.prokind<>'f' OR original.pronargs<>0 OR original.proargtypes<>''::oidvector
  OR original.prorettype<>'pg_catalog.trigger'::regtype OR original.proretset OR NOT original.prosecdef
  OR original.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
  OR original.proleakproof OR original.proisstrict OR original.provolatile<>'v' OR original.proparallel<>'u'
  OR pg_get_functiondef(original.oid) IS DISTINCT FROM p->>'before'
  OR public.static_weekly_digest_text(original.prosrc) IS DISTINCT FROM p->>'beforeBodyHash'
 THEN RAISE EXCEPTION 'Exact original Coverall callback Source differs';END IF;
 SELECT jsonb_agg(to_jsonb(t) ORDER BY t.tgrelid,t.tgname) INTO original_triggers FROM pg_catalog.pg_trigger t WHERE t.tgfoid=original.oid;
 IF jsonb_array_length(original_triggers)<>2 OR
  (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgfoid=original.oid
   AND t.tgtype=5 AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgqual IS NULL
   AND t.tgnargs=0 AND octet_length(t.tgargs)=0 AND t.tgattr=''::int2vector AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
   AND ((t.tgrelid='custodial_coverall.activation_receipts'::regclass AND t.tgname='manual_operational_delivery_complete'
     AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred)
    OR (t.tgrelid='public.static_weekly_approved_initial_confirmations'::regclass AND t.tgname='manual_initial_delivery_complete'
     AND t.tgconstraint<>0 AND t.tgdeferrable AND t.tginitdeferred)))<>2
 THEN RAISE EXCEPTION 'Exact original Coverall callback consumers differ';END IF;
 EXECUTE p->>'after';
 SELECT * INTO STRICT after_row FROM pg_catalog.pg_proc WHERE oid=original.oid;
 SELECT jsonb_agg(to_jsonb(t) ORDER BY t.tgrelid,t.tgname) INTO after_triggers FROM pg_catalog.pg_trigger t WHERE t.tgfoid=original.oid;
 IF pg_get_functiondef(after_row.oid) IS DISTINCT FROM p->>'after'
  OR public.static_weekly_digest_text(after_row.prosrc) IS DISTINCT FROM p->>'afterBodyHash'
  OR to_jsonb(after_row)-'prosrc' IS DISTINCT FROM to_jsonb(original)-'prosrc'
  OR after_triggers IS DISTINCT FROM original_triggers
 THEN RAISE EXCEPTION 'Original Coverall callback metadata changed outside exact branch';END IF;
 PERFORM custodial_dr.immutable_import_owner_fence();
END $immutable_current_coverall_original$;
`;
 return {guard,install};
}
export function extendCurrentCoverallRestoreSource(sql){
 assert.equal(typeof sql,'string');assert.equal(sha(sql),predecessor);
 const {guard,install}=parts(),anchor='     -- These exact original constraint triggers still execute at COMMIT.\n';
 assert.equal(sql.split(anchor).length,2);assert.ok(sql.endsWith('COMMIT;\n'));
 const next=sql.replace(anchor,()=>guard+anchor).slice(0,-'COMMIT;\n'.length)+install+'COMMIT;\n';
 assert.equal(removeCurrentCoverallRestoreSource(next),sql);return next;
}
export function removeCurrentCoverallRestoreSource(sql){
 const {guard,install}=parts();assert.equal(sql.split(guard).length,2);assert.equal(sql.split(install).length,2);
 const previous=sql.replace(guard,'').replace(install,'');assert.equal(sha(previous),predecessor);return previous;
}
