// Current-only restore admission for two unchanged, read-only receipt checks.
// No trigger, function, constraint, role or original row is altered here.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const sha=value=>createHash('sha256').update(value).digest('hex');
export const deferredGuardPredecessorSha='7e870367cbadce546c678dd239cb2ee8d9c829e059e06a29a45b88c7693f105a';
const anchor='     AND NOT EXISTS(\n      SELECT 1 FROM (VALUES\n';
const diagnosticAnchor=' END AS function_sha256\n    INTO unsupported_insert_guard\n';
const diagnosticSelect=` END AS function_sha256,
    CASE WHEN guard_relation_namespace.nspname='custodial_coverall'
      AND ((guard_relation.relname='activation_operations' AND t.tgname='complete_coverall_activation')
       OR (guard_relation.relname='recurring_materialization_operations' AND t.tgname='complete_recurring_receipt'))
     THEN jsonb_build_array(
      current_user=session_user AND session_user='postgres',
      guard_function.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user),
      EXISTS(SELECT 1 FROM pg_catalog.pg_constraint rc WHERE rc.oid=t.tgconstraint AND rc.conname=t.tgname
       AND rc.conrelid=t.tgrelid AND rc.contype='t' AND rc.condeferrable AND rc.condeferred),
      t.tgdeferrable AND t.tginitdeferred AND t.tgconstraint<>0,
      t.tgtype=5,
      t.tgenabled::text=CASE guard_relation.relname WHEN 'activation_operations' THEN 'O' ELSE 'A' END,
      t.tgqual IS NULL AND t.tgnargs=0 AND octet_length(t.tgargs)=0 AND t.tgattr=''::int2vector
       AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL,
      guard_function.prokind='f' AND guard_function.pronargs=0
       AND guard_function.prorettype='pg_catalog.trigger'::regtype AND guard_function.prosecdef,
      EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory ri
       WHERE ri.object_kind='function' AND ri.definition_sql=pg_get_functiondef(guard_function.oid)
        AND ri.definition_sha256=public.static_weekly_digest_text(pg_get_functiondef(guard_function.oid))))
     END AS receipt_guard_checks
    INTO unsupported_insert_guard
`;
const detailAnchor="'function_sha256',unsupported_insert_guard.function_sha256)::text,8192);";
const detailWithChecks="'function_sha256',unsupported_insert_guard.function_sha256,\n      'receipt_guard_checks',unsupported_insert_guard.receipt_guard_checks)::text,8192);";
export const deferredReceiptGuardClause=`     -- These exact original constraint triggers still execute at COMMIT.
     -- They only verify the matching original receipt exists; missing receipts
     -- remain fatal. Independent retained installation Source pins these two
     -- definitions; a matching legacy recovery-registry row is not assumed.
     -- Never admit another deferred or side-effecting trigger.
     AND NOT EXISTS(
      SELECT 1 FROM (VALUES
       ('activation_operations','complete_coverall_activation','O','public.static_weekly_coverall_require_activation_receipt()',
        '8af8d04528a7b8210871adc1df0c41a4892ea4e9ff4b25829d46b4db8bece1a0'),
       ('recurring_materialization_operations','complete_recurring_receipt','A','public.static_weekly_manual_recurring_require_receipt()',
        '212cd9ccb4f69be4046d8dbb9f41a3188b88ece67ac455b544fc43cdbf7b6423')
      ) receipt_guard(table_name,trigger_name,enabled,function_identity,definition_sha256)
      JOIN pg_catalog.pg_proc receipt_function ON receipt_function.oid=to_regprocedure(receipt_guard.function_identity)
      JOIN pg_catalog.pg_constraint receipt_constraint ON receipt_constraint.oid=t.tgconstraint
      WHERE current_user=session_user AND session_user='postgres'
       AND item->>'schema_name'='custodial_coverall' AND item->>'table_name'=receipt_guard.table_name
       AND guard_relation_namespace.nspname='custodial_coverall' AND guard_relation.relname=receipt_guard.table_name
       AND t.tgname=receipt_guard.trigger_name AND t.tgfoid=receipt_function.oid
       AND t.tgtype=5 AND t.tgenabled=receipt_guard.enabled AND NOT t.tgisinternal
       AND t.tgdeferrable AND t.tginitdeferred AND t.tgconstraint<>0
       AND receipt_constraint.conname=receipt_guard.trigger_name AND receipt_constraint.conrelid=t.tgrelid
       AND receipt_constraint.contype='t' AND receipt_constraint.condeferrable AND receipt_constraint.condeferred
       AND t.tgqual IS NULL AND t.tgnargs=0 AND octet_length(t.tgargs)=0
       AND t.tgattr=''::int2vector AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
       AND receipt_function.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
       AND receipt_function.prokind='f' AND receipt_function.pronargs=0
       AND receipt_function.prorettype='pg_catalog.trigger'::regtype AND receipt_function.prosecdef
       AND public.static_weekly_digest_text(pg_get_functiondef(receipt_function.oid))=receipt_guard.definition_sha256)
`;
export function extendCurrentDeferredReceiptGuards(name,sql){
 assert.equal(name,'immutable-private-owner-context.sql');assert.equal(typeof sql,'string');
 assert.equal(sha(sql),deferredGuardPredecessorSha,'Whole exact current predecessor required');
 assert.equal(sql.split(anchor).length,2);
 // The independent source authority is the retained installation migration,
 // not a function definition or selector supplied by the restore target.
 const source=readFileSync(new URL('../release/installed-source/20261031125902_approved_manual_native_operations.sql',import.meta.url),'utf8');
 assert.equal(sha(source),'10238c293dda15a52321fa670f3763dd772ab6d976665cf306f737c613696b6d');
 for(const [identity,expected] of [
  ['public.static_weekly_coverall_require_activation_receipt()','8af8d04528a7b8210871adc1df0c41a4892ea4e9ff4b25829d46b4db8bece1a0'],
  ['public.static_weekly_manual_recurring_require_receipt()','212cd9ccb4f69be4046d8dbb9f41a3188b88ece67ac455b544fc43cdbf7b6423'],
 ]){
  const marker='CREATE FUNCTION '+identity+' RETURNS trigger';assert.equal(source.split(marker).length,2);
  const at=source.indexOf(marker),start=source.indexOf('AS $fn$',at)+'AS $fn$'.length,end=source.indexOf('$fn$;',start);assert.ok(start>at&&end>start);
  const definition='CREATE OR REPLACE FUNCTION '+identity+'\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO \'pg_catalog\', \'public\'\nAS $function$'+source.slice(start,end)+'$function$\n';
  assert.equal(sha(definition),expected);
 }
 assert.equal(sql.split(diagnosticAnchor).length,2);assert.equal(sql.split(detailAnchor).length,2);
 const next=sql.replace(anchor,()=>deferredReceiptGuardClause+anchor)
  .replace(diagnosticAnchor,()=>diagnosticSelect).replace(detailAnchor,()=>detailWithChecks);
 assert.equal(removeCurrentDeferredReceiptGuards(next),sql);return next;
}
export function removeCurrentDeferredReceiptGuards(sql){
 assert.equal(typeof sql,'string');assert.equal(sql.split(deferredReceiptGuardClause).length,2);
 assert.equal(sql.split(diagnosticSelect).length,2);assert.equal(sql.split(detailWithChecks).length,2);
 const previous=sql.replace(deferredReceiptGuardClause,'').replace(diagnosticSelect,()=>diagnosticAnchor).replace(detailWithChecks,()=>detailAnchor);
 assert.equal(sha(previous),deferredGuardPredecessorSha);return previous;
}
