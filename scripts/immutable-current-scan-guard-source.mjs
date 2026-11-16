// Exact original scan-evidence validation remains enabled and executes normally.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
const predecessor='6c40cc97124a0d7e63d9b9f2bcc4475e339a0ed6ab2044dd1c11cbb274bdc80d';
export const scanGuardClause=`     -- Exact original canonical scan validation and dependency still execute.
     AND NOT (current_user=session_user AND session_user='postgres'
      AND guard_relation_namespace.nspname='public' AND guard_relation.relname='custodial_offline_scan_event_evidence'
      AND t.tgname='trg_custodial_require_canonical_scan_evidence' AND t.tgtype=7 AND t.tgenabled='O'
      AND NOT t.tgisinternal AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND t.tgqual IS NULL AND t.tgnargs=0 AND octet_length(t.tgargs)=0 AND t.tgattr=''::int2vector
      AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
      AND t.tgfoid=to_regprocedure('public.custodial_require_canonical_scan_evidence_insert()')
      AND guard_function.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
      AND NOT guard_function.prosecdef
      AND public.static_weekly_digest_text(pg_get_functiondef(guard_function.oid))='86d35a41061fcc78a07d6acd2b48f4d8eb832d5153acc89c01c8db3ed9caa51f'
      AND EXISTS(SELECT 1 FROM pg_catalog.pg_proc scan_check
       WHERE scan_check.oid=to_regprocedure('public.custodial_scan_evidence_is_canonical(jsonb)')
        AND scan_check.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
        AND NOT scan_check.prosecdef
        AND public.static_weekly_digest_text(pg_get_functiondef(scan_check.oid))='afb309c3d2afdaf85d2127be244582ec9d2ac8bc63767aa3ccb31ddd8961a5bd'))
`;
export function verifyOriginalScanGuardSource(){
 const source=readFileSync(new URL('../supabase/migrations/20260813035530_offline_scan_authority_snapshot.sql',import.meta.url),'utf8');
 assert.equal(sha(source),'48d3272976876e418696fb7cc3294dce7ecb2fa6911b4468a56652ee6eb11cf9');
 const definitions=[];
 for(const [signature,header,pin] of [
 ['custodial_require_canonical_scan_evidence_insert()'," RETURNS trigger\n LANGUAGE plpgsql\n SET search_path TO 'pg_catalog', 'public'\n",'86d35a41061fcc78a07d6acd2b48f4d8eb832d5153acc89c01c8db3ed9caa51f'],
 ['custodial_scan_evidence_is_canonical(p_event jsonb)'," RETURNS boolean\n LANGUAGE sql\n IMMUTABLE\n SET search_path TO 'pg_catalog', 'public'\n",'afb309c3d2afdaf85d2127be244582ec9d2ac8bc63767aa3ccb31ddd8961a5bd']]){
  const marker='create or replace function public.'+signature;assert.equal(source.split(marker).length,2);
  const at=source.indexOf(marker),start=source.indexOf('as $function$',at)+'as $function$'.length,end=source.indexOf('$function$;',start);assert.ok(start>at&&end>start);
  const definition='CREATE OR REPLACE FUNCTION public.'+signature+'\n'+header+'AS $function$'+source.slice(start,end)+'$function$\n';assert.equal(sha(definition),pin);definitions.push(definition);
 }
 assert.ok(source.includes('create trigger trg_custodial_require_canonical_scan_evidence\nbefore insert on public.custodial_offline_scan_event_evidence\nfor each row execute function public.custodial_require_canonical_scan_evidence_insert();'));
 return definitions;
}
export function extendCurrentScanGuard(sql){
 assert.equal(sha(sql),predecessor);verifyOriginalScanGuardSource();const anchor='     -- Original taxonomy checks still reject inconsistent completion answers.\n';assert.equal(sql.split(anchor).length,2);
 const next=sql.replace(anchor,()=>scanGuardClause+anchor);assert.equal(removeCurrentScanGuard(next),sql);return next;
}
export function removeCurrentScanGuard(sql){
 assert.equal(sql.split(scanGuardClause).length,2);const prior=sql.replace(scanGuardClause,'');assert.equal(sha(prior),predecessor);return prior;
}
