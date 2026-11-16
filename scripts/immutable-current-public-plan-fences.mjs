// Exact retained53-table declaration of an unchanged shared advisory lock.
// No caller-defined relation, function or trigger is accepted.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
export function originalPublicPlanFenceRelations(){
 assert.equal(arguments.length,0);
 const bytes=readFileSync(new URL('../release/installed-source/20261022071830_recurring_normal_notification_plan.sql',import.meta.url));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'f3083dba31b1973cd42692362ceda5e4c08d505c063ceb505c75214dd4e16c95');
 const source=bytes.toString('utf8');assert.equal(source.split('do $source_triggers$').length,2);
 const section=source.split('do $source_triggers$')[1].split('end $source_triggers$;')[0],matches=[...section.matchAll(/foreach name in array array\[(.*?)\]::text\[\] loop/g)];assert.equal(matches.length,1);
 const literal=matches[0][1],names=[...literal.matchAll(/'(public\.[a-z_][a-z0-9_]*)'/g)].map(m=>m[1]);
 assert.equal(names.length,53);assert.equal(new Set(names).size,53);assert.equal(names.map(n=>"'"+n+"'").join(','),literal);
 assert.ok(source.includes("execute format('create trigger custodial_recurring_notification_plan_source_fence before insert or update or delete or truncate on %s for each statement execute function public.static_weekly_v27_notification_plan_source_write_fence()',name);"));
 assert.ok(source.includes("execute format('alter table %s enable always trigger custodial_recurring_notification_plan_source_fence',name);"));
 return Object.freeze(names);
}
export function currentPublicPlanSourceFenceGuards(){
 assert.equal(arguments.length,0);
 // completion_responses already has an exact current clause. Retain that
 // predecessor and admit the other52 Source-identical statement locks here.
 const rows=originalPublicPlanFenceRelations().filter(n=>n!=='public.completion_responses').map(n=>"       ('"+n.slice(7)+"')").join(',\n');
 return `     -- Exact remaining retained public source fences still take their shared lock.
     AND NOT EXISTS(
      SELECT 1 FROM (VALUES
${rows}
      ) original_public_fence(table_name)
      WHERE current_user=session_user AND session_user='postgres'
       AND guard_relation_namespace.nspname='public' AND guard_relation.relname=original_public_fence.table_name
       AND item->>'schema_name'='public' AND item->>'table_name'=original_public_fence.table_name
       AND t.tgname='custodial_recurring_notification_plan_source_fence' AND t.tgtype=62 AND t.tgenabled='A'
       AND NOT t.tgisinternal AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
       AND t.tgqual IS NULL AND t.tgnargs=0 AND octet_length(t.tgargs)=0 AND t.tgattr=''::int2vector
       AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
       AND t.tgfoid=to_regprocedure('public.static_weekly_v27_notification_plan_source_write_fence()')
       AND guard_function.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
       AND guard_function.prosecdef
       AND public.static_weekly_digest_text(pg_get_functiondef(guard_function.oid))='4fc0ef22db650c17c5d98a35ef62ba165c6fe7301408bd9aab454e875a724fff')
`;
}
