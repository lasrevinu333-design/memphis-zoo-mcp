// One fixed restore-only branch for exact archived legacy daily rows. Ordinary
// schedule writes retain the complete original static-weekly retirement fence.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
const predecessor='5bd50bfdad8af91a631d76f0eed9374cb861f10e78bf620ef0435e67df5952bd';
export const legacyDailyFenceIdentity='public.static_weekly_reject_legacy_daily_schedule_write()';
const branch=`  -- Restore only the exact archived row; ordinary legacy writes remain retired.
  IF TG_OP='INSERT' AND TG_LEVEL='ROW' AND TG_WHEN='BEFORE' AND TG_NARGS=0
   AND TG_TABLE_SCHEMA='public'
   AND TG_TABLE_NAME IN('daily_absence_overrides','daily_group_assignments','daily_schedule_assignments','daily_work_roster')
   AND TG_NAME='trg_static_weekly_fence_'||TG_TABLE_NAME THEN
   IF TG_RELID=pg_catalog.to_regclass('public.'||TG_TABLE_NAME)
    AND current_user=session_user AND current_user='postgres' THEN
    IF custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) IS TRUE
     THEN RETURN NEW; END IF;
   END IF;
  END IF;
`;
export function currentLegacyDailyFenceRecipe(){
 assert.equal(arguments.length,0);
 const source=readFileSync(new URL('../supabase/migrations/20260826114516_retire_legacy_daily_schedule_writers_after_static_weekly_cutover.sql',import.meta.url),'utf8');
 assert.equal(sha(source),'62329525c73705bb253fc87cd2c31c9b29ecb89a5cce14b550d4b04dce727cbf');
 const marker='create or replace function '+legacyDailyFenceIdentity+'\n';assert.equal(source.split(marker).length,2);
 const at=source.indexOf(marker),start=source.indexOf('as $function$',at)+'as $function$'.length,end=source.indexOf('$function$;',start);assert.ok(start>at&&end>start);
 const original=source.slice(start,end);
 const before='CREATE OR REPLACE FUNCTION '+legacyDailyFenceIdentity+"\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public'\nAS $function$"+original+'$function$\n';
 assert.equal(sha(before),'b5ec11e238f5ee0db016ef8ca8db0be6cdf4c535a1c4124335b9b2de5ed458a0');
 assert.equal(original.split('\nbegin\n').length,2);
 const afterBody=original.replace('\nbegin\n',()=> '\nbegin\n'+branch),after=before.replace('\nbegin\n',()=> '\nbegin\n'+branch);
 assert.equal(after.replace(branch,''),before);
 return Object.freeze({identity:legacyDailyFenceIdentity,registry_identity:'static_weekly_reject_legacy_daily_schedule_write()',before,after,
  beforeHash:sha(before),afterHash:sha(after),beforeBodyHash:sha(original),afterBodyHash:sha(afterBody)});
}
function parts(){
 const r=currentLegacyDailyFenceRecipe();
 const guard=`     -- Four exact consumers of the registered legacy daily schedule fence.
     AND NOT (current_user=session_user AND session_user='postgres'
      AND guard_relation_namespace.nspname='public'
      AND guard_relation.relname IN('daily_absence_overrides','daily_group_assignments','daily_schedule_assignments','daily_work_roster')
      AND t.tgname='trg_static_weekly_fence_'||guard_relation.relname
      AND t.tgtype=31 AND t.tgenabled='O'
      AND NOT t.tgisinternal AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND t.tgqual IS NULL AND t.tgnargs=0 AND octet_length(t.tgargs)=0 AND t.tgattr=''::int2vector
      AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
      AND t.tgfoid=to_regprocedure('public.static_weekly_reject_legacy_daily_schedule_write()')
      AND guard_function.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
      AND guard_function.prosecdef
      AND public.static_weekly_digest_text(pg_get_functiondef(guard_function.oid))='${r.afterHash}'
      AND EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory daily_fence_inventory
       WHERE daily_fence_inventory.object_kind='function'
        AND daily_fence_inventory.object_identity='static_weekly_reject_legacy_daily_schedule_write()'
        AND daily_fence_inventory.definition_sql=pg_get_functiondef(guard_function.oid)
        AND daily_fence_inventory.definition_sha256='${r.afterHash}'))
`;
 const install=`
-- Exact current Source only. No role, ACL, trigger or application DATA change.
DO $immutable_current_legacy_daily_fence$
DECLARE p constant jsonb:=$legacy_daily_fence_profile$${JSON.stringify(r)}$legacy_daily_fence_profile$::jsonb;
 original pg_catalog.pg_proc%rowtype;after_row pg_catalog.pg_proc%rowtype;
 original_triggers jsonb;after_triggers jsonb;
BEGIN
 PERFORM custodial_dr.immutable_import_owner_fence();
 IF current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Exact isolated original daily fence owner required';END IF;
 LOCK TABLE public.daily_absence_overrides,public.daily_group_assignments,public.daily_schedule_assignments,public.daily_work_roster IN ACCESS EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM public.daily_absence_overrides UNION ALL SELECT 1 FROM public.daily_group_assignments
  UNION ALL SELECT 1 FROM public.daily_schedule_assignments UNION ALL SELECT 1 FROM public.daily_work_roster)
 THEN RAISE EXCEPTION 'Original daily fence integration requires fresh DATA';END IF;
 SELECT * INTO STRICT original FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(p->>'identity');
 SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) INTO original_triggers FROM pg_catalog.pg_trigger t WHERE t.tgfoid=original.oid;
 IF original.proowner<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
  OR original.prokind<>'f' OR original.pronargs<>0 OR original.proargtypes<>''::oidvector
  OR original.prorettype<>'pg_catalog.trigger'::regtype OR original.proretset OR NOT original.prosecdef
  OR original.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
  OR original.proleakproof OR original.proisstrict OR original.provolatile<>'v' OR original.proparallel<>'u'
  OR pg_get_functiondef(original.oid) IS DISTINCT FROM p->>'before'
  OR public.static_weekly_digest_text(original.prosrc) IS DISTINCT FROM p->>'beforeBodyHash'
  OR jsonb_array_length(original_triggers) IS DISTINCT FROM 4
  OR (SELECT count(*) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE t.tgfoid=original.oid AND n.nspname='public'
    AND c.relname IN('daily_absence_overrides','daily_group_assignments','daily_schedule_assignments','daily_work_roster')
    AND t.tgname='trg_static_weekly_fence_'||c.relname
    AND t.tgtype=31 AND t.tgenabled='O' AND NOT t.tgisinternal
    AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
    AND t.tgqual IS NULL AND t.tgnargs=0 AND octet_length(t.tgargs)=0
    AND t.tgattr=''::int2vector AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL)<>4
 THEN RAISE EXCEPTION 'Exact original daily fence Source or consumers differ';END IF;
 EXECUTE p->>'after';
 SELECT * INTO STRICT after_row FROM pg_catalog.pg_proc WHERE oid=original.oid;
 SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) INTO after_triggers FROM pg_catalog.pg_trigger t WHERE t.tgfoid=original.oid;
 IF pg_get_functiondef(after_row.oid) IS DISTINCT FROM p->>'after'
  OR public.static_weekly_digest_text(after_row.prosrc) IS DISTINCT FROM p->>'afterBodyHash'
  OR to_jsonb(after_row)-'prosrc' IS DISTINCT FROM to_jsonb(original)-'prosrc'
  OR after_triggers IS DISTINCT FROM original_triggers
 THEN RAISE EXCEPTION 'Original daily fence metadata changed outside exact branch';END IF;
 PERFORM custodial_dr.immutable_import_owner_fence();
END $immutable_current_legacy_daily_fence$;
`;
 return {guard,install};
}
export function extendCurrentLegacyDailyFence(sql){
 assert.equal(arguments.length,1);assert.equal(typeof sql,'string');assert.equal(sha(sql),predecessor);
 const {guard,install}=parts(),anchor='     -- Original taxonomy checks still reject inconsistent completion answers.\n';
 assert.equal(sql.split(anchor).length,2);assert.ok(sql.endsWith('COMMIT;\n'));
 const next=sql.replace(anchor,()=>guard+anchor).slice(0,-'COMMIT;\n'.length)+install+'COMMIT;\n';
 assert.equal(removeCurrentLegacyDailyFence(next),sql);return next;
}
export function removeCurrentLegacyDailyFence(sql){
 const {guard,install}=parts();assert.equal(sql.split(guard).length,2);assert.equal(sql.split(install).length,2);
 const previous=sql.replace(guard,'').replace(install,'');assert.equal(sha(previous),predecessor);return previous;
}
