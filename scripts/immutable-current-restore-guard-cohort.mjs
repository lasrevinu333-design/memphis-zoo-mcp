// Closed offline composition for the remaining original INSERT consumers.
// No runtime caller selects a function, table, recipe, owner or replacement.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
const priorPin='952d9dabdcf4c219c513f0137340a37318376ac7fd46dec760f6addc29ae6bf6';
const sourcePin='d69019c73934ae977b06c4f1ae8eeadfb32b94d51a281cf7413599d2aa3a814d';
const lockIdentity='public.static_weekly_v15_lock_recurring_mutation()';
const existing=Object.freeze(['custodial_coverall.bind_manual_delivery_after_acceptance()',
 'public.custodial_record_offline_authority_activation_boundary()',
 'public.ops_manager_notification_validate_owner()',
 'public.static_weekly_v15_advance_recurring_generation()']);
const unregistered=Object.freeze(['custodial_coverall.bind_manual_delivery_after_acceptance()',
 'custodial_coverall.reconcile_manual_delivery_after_lunch()','public.sync_migration_log_summary()']);
const body=s=>{assert.equal(s.split('AS $function$').length,2);assert.ok(s.endsWith('$function$\n'));return s.split('AS $function$')[1].slice(0,-'$function$\n'.length);};
const sqlString=s=>"'"+s.replaceAll("'","''")+"'";
const serial=p=>JSON.stringify(p,null,2)+'\n';
export function currentRestoreGuardCohortSources(){
 assert.equal(arguments.length,0);
 const raw=readFileSync(new URL('../release/installed-source/20261120_restore_guard_predecessors.json',import.meta.url),'utf8');assert.equal(sha(raw),sourcePin);
 const source=JSON.parse(raw);assert.equal(source.format,'custodial.restore-original-trigger-predecessors.v1');
 const fs=source.functions;assert.equal(fs.length,24);assert.equal(new Set(fs.map(f=>f.identity)).size,24);
 for(const f of fs){
  assert.equal(f.owner,'postgres');assert.equal(sha(f.definition),f.definition_sha256);body(f.definition);
  assert.ok(f.triggers.length>0);assert.equal(f.registry.length,unregistered.includes(f.identity)?0:1);
  for(const t of f.triggers){
   assert.ok(/^(public|custodial_coverall)$/.test(t.schema));assert.match(t.table,/^[a-z_][a-z0-9_]*$/);assert.match(t.name,/^[a-z_][a-z0-9_]*$/);
   assert.equal(t.internal,false);assert.equal(t.when,null);assert.equal(t.nargs,0);assert.equal(t.args_hex,'');assert.equal(t.old_table,null);assert.equal(t.new_table,null);
   if(f.identity!==lockIdentity)assert.ok((t.type&1)!==0);
   if(t.constraint)assert.ok(t.deferrable&&t.initially_deferred&&t.type===5&&['manual_initial_delivery_complete','manual_native_delivery_after_lunch'].includes(t.name));
  }
 }
 return fs;
}
const deferredTables=Object.freeze(['static_weekly_approved_initial_confirmations','weekly_schedule_lunch_documents']);
function insertBranch(f){
 const rows=f.triggers.filter(t=>(t.type&4)!==0);assert.ok(rows.length>0);
 const cases=rows.map(t=>`(TG_TABLE_SCHEMA=${sqlString(t.schema)} AND TG_TABLE_NAME=${sqlString(t.table)}
     AND TG_NAME=${sqlString(t.name)} AND TG_WHEN=${sqlString((t.type&2)!==0?'BEFORE':'AFTER')}
     AND TG_RELID=pg_catalog.to_regclass(${sqlString(t.schema+'.'+t.table)}))`).join('\n    OR ');
 const deferred=rows.filter(t=>t.constraint);assert.ok(deferred.every(t=>t.schema==='public'&&deferredTables.includes(t.table)));
 return `  -- Exact authenticated archived INSERT only. The entire normal body follows unchanged.
  IF TG_OP='INSERT' AND TG_LEVEL='ROW' AND TG_NARGS=0
   AND current_user=session_user AND current_user='postgres'
   AND (${cases}) THEN
   IF custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) IS TRUE
    THEN RETURN NEW; END IF;
${deferred.length?`   IF custodial_dr.immutable_import_matches_deferred_original_record(TG_RELID,NEW) IS TRUE
    THEN RETURN NEW; END IF;\n`:''}  END IF;
`;
}
function addBranch(definition,branch){
 const anchors=['\nbegin\n','\nBEGIN\n'].filter(a=>definition.includes(a));assert.equal(anchors.length,1);
 const a=anchors[0];assert.equal(definition.split(a).length,2);const after=definition.replace(a,()=>a+branch);assert.equal(after.replace(branch,''),definition);return after;
}
function makeRecipe(f,old){
 if(old){assert.equal(old.before,f.definition);assert.equal(old.beforeHash,f.definition_sha256);}
 const before=f.definition,after=addBranch(old?.after??before,insertBranch(f));
 return {identity:f.identity,registry_identity:old?.registry_identity??f.registry[0]?.object_identity??f.identity,
  before,after,beforeHash:sha(before),afterHash:sha(after),beforeBodyHash:sha(body(before)),afterBodyHash:sha(body(after))};
}
export const deferredOriginalMatcherSql=`
-- This read-only matcher is limited to the two original deferred callbacks.
-- It cannot authorize a write, timing change, replay, resume or new receipt.
CREATE FUNCTION custodial_dr.immutable_import_matches_deferred_original_record(p_table_oid oid,p_new_row anyelement)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $deferred_original$
DECLARE ctx custodial_dr.immutable_private_import_context;checked custodial_dr.immutable_private_import_context;
 staged custodial_dr.immutable_ordinary_import_rows;expected_count bigint;observed bigint:=0;matches bigint:=0;
 actual_matches bigint;projection text;original_projection text;member jsonb;
BEGIN
 IF current_user<>session_user OR current_user<>'postgres' OR pg_catalog.pg_trigger_depth()<>1
  OR p_table_oid NOT IN('public.static_weekly_approved_initial_confirmations'::regclass,'public.weekly_schedule_lunch_documents'::regclass)
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=p_table_oid AND c.reltype=pg_typeof(p_new_row)::oid)
 THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM custodial_dr.immutable_private_import_context
  WHERE database_oid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
   AND backend_pid=pg_backend_pid() AND transaction_id=txid_current()) THEN RETURN false;END IF;
 ctx:=custodial_dr.immutable_import_assert_context();
 IF ctx.phase<>'FINISHED' OR ctx.active_table_oid IS NOT NULL OR ctx.active_row_sha256 IS NOT NULL THEN RETURN false;END IF;
 SELECT v INTO STRICT member FROM jsonb_array_elements(ctx.original_manifest->'catalog') v
  JOIN pg_catalog.pg_class c ON c.oid=p_table_oid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE v->>'schema_name'=n.nspname AND v->>'table_name'=c.relname;
 expected_count:=(member->>'row_count')::bigint;
 projection:=custodial_dr.immutable_import_row_projection(p_new_row);
 FOR staged IN SELECT s.* FROM custodial_dr.immutable_ordinary_import_rows s
  WHERE s.database_oid=ctx.database_oid AND s.backend_pid=ctx.backend_pid AND s.transaction_id=ctx.transaction_id
   AND s.table_oid=p_table_oid ORDER BY s.ordinal LOOP
  observed:=observed+1;
  IF staged.ordinal IS DISTINCT FROM observed
   OR staged.original_row_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(staged.original_row_utf8,'UTF8'),'sha256'),'hex')
  THEN RAISE EXCEPTION 'Exact deferred original ordinal or raw digest differs';END IF;
  EXECUTE format('SELECT custodial_dr.immutable_import_row_projection(r) FROM custodial_dr.immutable_import_decode_record(null::%s,$1::text) r',p_table_oid::regclass)
   INTO original_projection USING staged.original_row_utf8;
  IF original_projection IS DISTINCT FROM staged.typed_original_text THEN RAISE EXCEPTION 'Exact deferred original codec differs';END IF;
  IF original_projection IS NOT DISTINCT FROM projection THEN matches:=matches+1;END IF;
 END LOOP;
 IF observed IS DISTINCT FROM expected_count OR matches<>1 THEN RETURN false;END IF;
 EXECUTE format('SELECT count(*) FROM ONLY %s r WHERE custodial_dr.immutable_import_row_projection(r)=$1',p_table_oid::regclass)
  INTO actual_matches USING projection;
 IF actual_matches<>1 THEN RETURN false;END IF;
 checked:=custodial_dr.immutable_import_assert_context();
 IF checked IS DISTINCT FROM ctx THEN RAISE EXCEPTION 'Exact deferred original transaction changed';END IF;
 RETURN true;
END $deferred_original$;
DO $deferred_original_acl$
DECLARE f pg_catalog.pg_proc%rowtype;acl record;
BEGIN
 PERFORM custodial_dr.immutable_import_owner_fence();
 SELECT * INTO STRICT f FROM pg_catalog.pg_proc WHERE oid='custodial_dr.immutable_import_matches_deferred_original_record(oid,anyelement)'::regprocedure;
 IF f.proowner<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user) THEN RAISE EXCEPTION 'Original deferred matcher owner differs';END IF;
 FOR acl IN SELECT a.grantee FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a WHERE a.grantee<>f.proowner LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION custodial_dr.immutable_import_matches_deferred_original_record(oid,anyelement) FROM '
   ||CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(acl.grantee)) END;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  WHERE p.oid=f.oid AND (a.grantee<>p.proowner OR a.grantor<>p.proowner OR a.privilege_type<>'EXECUTE'))
 THEN RAISE EXCEPTION 'Original deferred matcher exposes non-owner authority';END IF;
END $deferred_original_acl$;
`;
const triggerProjection=`jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'type',t.tgtype,'enabled',t.tgenabled,
 'internal',t.tgisinternal,'constraint',t.tgconstraint<>0,'deferrable',t.tgdeferrable,'initially_deferred',t.tginitdeferred,
 'when',pg_get_expr(t.tgqual,t.tgrelid),'nargs',t.tgnargs,'args_hex',encode(t.tgargs,'hex'),'old_table',t.tgoldtable,'new_table',t.tgnewtable,
 'columns',coalesce((SELECT jsonb_agg(a.attname ORDER BY cols.ord) FROM unnest(t.tgattr::smallint[]) WITH ORDINALITY cols(attnum,ord)
  JOIN pg_catalog.pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=cols.attnum AND NOT a.attisdropped),'[]'::jsonb))`;
function parts(prior){
 const sources=currentRestoreGuardCohortSources(),old=new Map(prior.recipes.map(r=>[r.identity,r]));
 assert.ok(existing.every(id=>old.has(id)));assert.equal(sources.filter(f=>f.identity!==lockIdentity&&!old.has(f.identity)).length,19);
 const nextRecipes=sources.filter(f=>f.identity!==lockIdentity).map(f=>makeRecipe(f,old.get(f.identity)));
 const byId=new Map(nextRecipes.map(r=>[r.identity,r]));
 const guardRows=sources.flatMap(f=>f.triggers.filter(t=>(t.type&4)!==0).map(t=>({identity:f.identity,definition_sha256:byId.get(f.identity)?.afterHash??f.definition_sha256,
  security_definer:f.security_definer,registry_identity:f.registry[0]?.object_identity??null,...t})));
 const guard=`     -- Closed current original consumer cohort; no generic trigger exception.
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements($current_original_guard_cohort$${JSON.stringify(guardRows)}$current_original_guard_cohort$::jsonb) g
      WHERE current_user=session_user AND session_user='postgres'
       AND guard_relation_namespace.nspname=g->>'schema' AND guard_relation.relname=g->>'table'
       AND t.tgname=g->>'name' AND t.tgfoid=to_regprocedure(g->>'identity')
       AND t.tgtype=(g->>'type')::smallint AND t.tgenabled::text=g->>'enabled' AND NOT t.tgisinternal
       AND (t.tgconstraint<>0)=(g->>'constraint')::boolean
       AND t.tgdeferrable=(g->>'deferrable')::boolean AND t.tginitdeferred=(g->>'initially_deferred')::boolean
       AND (t.tgconstraint=0 OR EXISTS(SELECT 1 FROM pg_catalog.pg_constraint rc
        WHERE rc.oid=t.tgconstraint AND rc.conname=t.tgname AND rc.conrelid=t.tgrelid AND rc.contype='t'
         AND rc.condeferrable=t.tgdeferrable AND rc.condeferred=t.tginitdeferred))
       AND t.tgqual IS NULL AND t.tgnargs=0 AND octet_length(t.tgargs)=0 AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
       AND coalesce((SELECT jsonb_agg(a.attname ORDER BY cols.ord) FROM unnest(t.tgattr::smallint[]) WITH ORDINALITY cols(attnum,ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=cols.attnum AND NOT a.attisdropped),'[]'::jsonb)=g->'columns'
       AND guard_function.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
       AND guard_function.prosecdef=(g->>'security_definer')::boolean
       AND public.static_weekly_digest_text(pg_get_functiondef(guard_function.oid))=g->>'definition_sha256'
       AND (g->>'registry_identity' IS NULL OR EXISTS(SELECT 1 FROM public.custodial_release_authority_restore_inventory ri
        WHERE ri.object_kind='function' AND ri.object_identity=g->>'registry_identity'
         AND ri.definition_sql=pg_get_functiondef(guard_function.oid) AND ri.definition_sha256=g->>'definition_sha256')))
`;
 const installation=nextRecipes.map(r=>{
  const f=sources.find(f=>f.identity===r.identity),before=old.get(r.identity)?.after??r.before;
  return {identity:r.identity,install_before:before,install_before_body_sha256:sha(body(before)),after:r.after,after_body_sha256:r.afterBodyHash,
   security_definer:f.security_definer,triggers:f.triggers};
 });
 const install=deferredOriginalMatcherSql+`
DO $current_original_guard_cohort_install$
DECLARE profiles constant jsonb:=$current_original_guard_profiles$${JSON.stringify(installation)}$current_original_guard_profiles$::jsonb;
 p jsonb;relation record;original pg_catalog.pg_proc%rowtype;after_row pg_catalog.pg_proc%rowtype;
 original_triggers jsonb;after_triggers jsonb;normalized_triggers jsonb;nonempty boolean;
BEGIN
 PERFORM custodial_dr.immutable_import_owner_fence();
 IF current_user<>session_user OR current_user<>'postgres' THEN RAISE EXCEPTION 'Exact isolated original cohort owner required';END IF;
 FOR relation IN SELECT DISTINCT t->>'schema' schema_name,t->>'table' table_name FROM jsonb_array_elements(profiles) f
  CROSS JOIN LATERAL jsonb_array_elements(f->'triggers') t ORDER BY schema_name,table_name LOOP
  EXECUTE format('LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE',relation.schema_name,relation.table_name);
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM ONLY %I.%I)',relation.schema_name,relation.table_name) INTO nonempty;
  IF nonempty THEN RAISE EXCEPTION 'Original cohort requires fresh DATA';END IF;
 END LOOP;
 FOR p IN SELECT v FROM jsonb_array_elements(profiles) v LOOP
  SELECT * INTO STRICT original FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(p->>'identity');
  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid),jsonb_agg(${triggerProjection} ORDER BY n.nspname,c.relname,t.tgname)
   INTO original_triggers,normalized_triggers FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE t.tgfoid=original.oid;
  IF original.proowner<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
   OR original.prokind<>'f' OR original.pronargs<>0 OR original.proargtypes<>''::oidvector
   OR original.prorettype<>'pg_catalog.trigger'::regtype OR original.proretset
   OR original.prosecdef IS DISTINCT FROM (p->>'security_definer')::boolean
   OR pg_get_functiondef(original.oid) IS DISTINCT FROM p->>'install_before'
   OR public.static_weekly_digest_text(original.prosrc) IS DISTINCT FROM p->>'install_before_body_sha256'
   OR normalized_triggers IS DISTINCT FROM p->'triggers'
  THEN RAISE EXCEPTION 'Exact original cohort Source or consumers differ';END IF;
  EXECUTE p->>'after';
  SELECT * INTO STRICT after_row FROM pg_catalog.pg_proc WHERE oid=original.oid;
  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) INTO after_triggers FROM pg_catalog.pg_trigger t WHERE t.tgfoid=original.oid;
  IF pg_get_functiondef(after_row.oid) IS DISTINCT FROM p->>'after'
   OR public.static_weekly_digest_text(after_row.prosrc) IS DISTINCT FROM p->>'after_body_sha256'
   OR to_jsonb(after_row)-'prosrc' IS DISTINCT FROM to_jsonb(original)-'prosrc'
   OR after_triggers IS DISTINCT FROM original_triggers
  THEN RAISE EXCEPTION 'Original cohort metadata changed outside exact branch';END IF;
 END LOOP;
 PERFORM custodial_dr.immutable_import_owner_fence();
END $current_original_guard_cohort_install$;
`;
 return {guard,install,nextRecipes};
}
const anchor='     -- Original taxonomy checks still reject inconsistent completion answers.\n';
export function extendCurrentRestoreGuardCohort(prior){
 assert.equal(arguments.length,1);assert.equal(sha(serial(prior)),priorPin);
 const {guard,install,nextRecipes}=parts(prior),p=structuredClone(prior),byId=new Map(nextRecipes.map(r=>[r.identity,r]));
 p.recipes=p.recipes.map(r=>byId.get(r.identity)??r).concat(nextRecipes.filter(r=>!existing.includes(r.identity)));
 const s=p.statements[0];assert.equal(s.sql.split(anchor).length,2);s.sql=s.sql.replace(anchor,()=>guard+anchor);s.sourceSha256=sha(s.sql);
 const last=p.statements.at(-1);last.sql+=install;last.sourceSha256=sha(last.sql);
 assert.deepEqual(removeCurrentRestoreGuardCohort(p),prior);return p;
}
export function removeCurrentRestoreGuardCohort(program){
 assert.equal(arguments.length,1);const p=structuredClone(program),sources=currentRestoreGuardCohortSources();
 const added=sources.filter(f=>f.identity!==lockIdentity&&!existing.includes(f.identity));assert.equal(added.length,19);
 assert.deepEqual(p.recipes.slice(-19),added.map(f=>makeRecipe(f)));p.recipes.splice(-19);
 for(const id of existing){
  const r=p.recipes.find(r=>r.identity===id),f=sources.find(f=>f.identity===id),branch=insertBranch(f);assert.equal(r.after.split(branch).length,2);
  r.after=r.after.replace(branch,'');r.afterHash=sha(r.after);r.afterBodyHash=sha(body(r.after));
 }
 const {guard,install}=parts(p),s=p.statements[0],last=p.statements.at(-1);
 assert.equal(s.sql.split(guard).length,2);s.sql=s.sql.replace(guard,'');s.sourceSha256=sha(s.sql);
 assert.ok(last.sql.endsWith(install));last.sql=last.sql.slice(0,-install.length);last.sourceSha256=sha(last.sql);
 assert.equal(sha(serial(p)),priorPin);return p;
}
