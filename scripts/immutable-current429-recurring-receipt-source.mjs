import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {readVerifiedArchiveSourceBinding} from './disaster-recovery-archive.mjs';
import {projectDeferredOriginalIndex} from './immutable-current-live-data-source.mjs';
import {loadImmutableCurrentPostgresSource} from './immutable-private-postgres-source.mjs';

export const current429BackupDigest='f305655a56e2538b41a21293f76750c752ec063196cac452ad11d9fe9865c489';
export const recurringReceiptIdentity='custodial_coverall.reconcile_manual_delivery_after_recurring_receipt()';
const table='recurring_materialization_receipts';
const trigger='manual_recurring_delivery_after_receipt';
const qualifiedTable=`custodial_coverall.${table}`;
const installedSource=new URL('../release/installed-source/20261031125902_approved_manual_native_operations.sql',import.meta.url);
const originalDefinitionHash='d2e502ffaa6767d8bd0f51e64e1998f2fecfa078a4c55538ec6b2fdb2f4708e2';
const sha=value=>createHash('sha256').update(value).digest('hex');

function readInstalledSource() {
  const source=readFileSync(installedSource,'utf8');
  assert.equal(sha(source),'10238c293dda15a52321fa670f3763dd772ab6d976665cf306f737c613696b6d');
  return source;
}

// Append one profile to the existing checked cohort. Its initializer verifies
// the original owner, complete trigger shape, freshness and unchanged ACLs.
function appendProfile(sql, delimiter, profile) {
  const parts=sql.split(delimiter);
  assert.equal(parts.length,3);
  const entries=JSON.parse(parts[1]);
  assert.ok(Array.isArray(entries)&&entries.every(row=>row.identity!==profile.identity));
  return [parts[0],JSON.stringify([...entries,profile]),parts[2]].join(delimiter);
}

export function compileCurrent429RecurringReceiptSource() {
  const program=loadImmutableCurrentPostgresSource();
  const source=readInstalledSource();
  const marker=`CREATE FUNCTION ${recurringReceiptIdentity}\n`;
  assert.equal(source.split(marker).length,2);
  assert.ok(source.includes(`CREATE CONSTRAINT TRIGGER ${trigger}\n AFTER INSERT ON ${qualifiedTable} DEFERRABLE INITIALLY DEFERRED\n FOR EACH ROW EXECUTE FUNCTION ${recurringReceiptIdentity};`));
  const bodyMatch=source.split(marker)[1].match(/\bAS \$recurring_delivery\$([\s\S]+?)\$recurring_delivery\$;/);
  assert.ok(bodyMatch);
  const originalBody=bodyMatch[1];
  const header=`CREATE OR REPLACE FUNCTION ${recurringReceiptIdentity}\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog', 'public'\nAS $function$`;
  const before=header+originalBody+'$function$\n';
  assert.equal(sha(before),originalDefinitionHash);
  const branch=` -- Historical receipt DATA is checked against the owning transaction's exact archive row.
 IF TG_OP='INSERT' AND TG_LEVEL='ROW' AND TG_WHEN='AFTER' AND TG_NARGS=0
  AND TG_TABLE_SCHEMA='custodial_coverall' AND TG_TABLE_NAME='${table}' AND TG_NAME='${trigger}'
  AND TG_RELID=pg_catalog.to_regclass('${qualifiedTable}') AND current_user=session_user AND current_user='postgres'
  AND (custodial_dr.immutable_import_matches_ordinary_record(TG_RELID,NEW) IS TRUE
   OR custodial_dr.immutable_import_matches_deferred_original_record(TG_RELID,NEW) IS TRUE)
 THEN RETURN NEW; END IF;
`;
  const anchor='\nBEGIN\n';
  assert.equal(originalBody.split(anchor).length,2);
  const afterBody=originalBody.replace(anchor,()=>anchor+branch);
  const after=header+afterBody+'$function$\n';
  assert.equal(after.replace(branch,''),before);
  const recipe=Object.freeze({identity:recurringReceiptIdentity,registry_identity:recurringReceiptIdentity,
    before,after,beforeHash:originalDefinitionHash,afterHash:sha(after),beforeBodyHash:sha(originalBody),afterBodyHash:sha(afterBody)});
  const metadata={schema:'custodial_coverall',table,name:trigger,type:5,enabled:'O',internal:false,constraint:true,
    deferrable:true,initially_deferred:true,when:null,nargs:0,args_hex:'',old_table:null,new_table:null,columns:[]};

  const statements=[...program.statements];
  const first=statements[0];
  const last=statements.at(-1);
  const guardSql=appendProfile(first.sql,'$current_original_guard_cohort$',{
    identity:recipe.identity,definition_sha256:recipe.afterHash,security_definer:true,registry_identity:null,...metadata,
  });
  const tableCheck="'public.weekly_schedule_lunch_documents'::regclass)";
  function installRecurring(sql) {
    assert.equal(sql.split(tableCheck).length,2);
    const matcher=sql.replace(tableCheck,()=>`${tableCheck.slice(0,-1)},'${qualifiedTable}'::regclass)`);
    return appendProfile(matcher,'$current_original_guard_profiles$',{
      identity:recipe.identity,install_before:before,install_before_body_sha256:recipe.beforeBodyHash,after,
      after_body_sha256:recipe.afterBodyHash,security_definer:true,triggers:[metadata],
    });
  }
  const historical=projectDeferredOriginalIndex({statements:[last]},true);
  assert.ok(historical,'Exact indexed deferred-original predecessor required.');
  assert.equal(sha(installRecurring(historical.statements[0].sql)),'01e7514e605d952ca4a42040943829e682351431234a17fba3d980af35985450');
  const installSql=installRecurring(last.sql);
  assert.equal(sha(guardSql),'1cc900f72db4733af64ac51c9d0a83dbed04b5625d3575e37155ac3d80904806');
  assert.equal(sha(installSql),'9d510a522289e899f83bad2948da6392cad659704034d712348b3e6b3d4f8460');
  statements[0]=Object.freeze({...first,sql:guardSql,sourceSha256:sha(guardSql)});
  statements[statements.length-1]=Object.freeze({...last,sql:installSql,sourceSha256:sha(installSql)});
  const assertCurrent=function() {
    assert.equal(arguments.length,0);
    program.assertCurrent();
    assert.equal(sha(readInstalledSource()),sha(source));
  };
  return Object.freeze({...program,recipes:Object.freeze([...program.recipes,recipe]),statements:Object.freeze(statements),assertCurrent});
}

export function readVerifiedCurrent429RecurringReceiptSource(archive) {
  assert.equal(readVerifiedArchiveSourceBinding(archive).archive_digest,current429BackupDigest);
  return compileCurrent429RecurringReceiptSource();
}
