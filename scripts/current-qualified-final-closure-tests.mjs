// Runs the explicit current310 counterpart: only the two historical canonical
// checker path literals differ; every original behavioral assertion is retained.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {consumeCurrentQualifiedSqlFixture} from './current-qualified-sql-ci-fixture.mjs';
import {captureSchemaCatalog,fingerprintSchemaCatalog} from './schema-fingerprint-catalog.mjs';
import {currentQualificationSource,verifyCurrentFinalCounterpart,digest} from './current-qualified-catalog-invariant.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const report={schema:'custodial.current310-owned-final-closure.v2',passed:false,production:false,release_admission:false,historical_test_pass_claimed:false,historical_canonical_equivalence:false};
let fixture,pool,output;
try {
 fixture=await consumeCurrentQualifiedSqlFixture({name:'mz_schema_rebuild_current310_closure_'+process.pid});
 const descriptor=JSON.parse(fs.readFileSync(process.env.CUSTODIAL_CURRENT310_OWNED_CI_DESCRIPTOR));
 output=path.join(descriptor.runtime,'ci-output','current310-final-closure-'+descriptor.owner);fs.mkdirSync(output,{mode:0o700});
 const source=currentQualificationSource();assert.deepEqual(descriptor.profile,source.profile);report.transformation=verifyCurrentFinalCounterpart();
 fs.writeFileSync(path.join(output,'COUNTERPART_TRANSFORMATION.json'),JSON.stringify(report.transformation,null,2)+'\n',{flag:'wx',mode:0o600});
 pool=new pg.Pool({...fixture.pgClientConfig,database:'postgres',user:'supabase_admin',max:1,connectionTimeoutMillis:5000});pool.on('error',()=>{});
 const capture=async()=>{await fixture.assertOwned();assert.deepEqual(currentQualificationSource(),source);const client=await pool.connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const result=fingerprintSchemaCatalog(await captureSchemaCatalog({query:async sql=>{
  const r=await client.query(sql);return {rows:r.rows.map(row=>{if(!Object.hasOwn(row,'object_comment'))return row;const x={...row,comment:row.object_comment};delete x.object_comment;return x;})};
 }}));await client.query('ROLLBACK');return result;}catch(error){try{await client.query('ROLLBACK');}catch{report.rollback_unknown=true;}throw error;}finally{client.release();}};
 const before=await capture();report.before_fingerprint=before.fingerprint;
 const invariantPath=path.join(output,'CURRENT310_CATALOG_INVARIANT.json');
 const invariant={schema:'custodial.current310-fresh-catalog-invariant.v1',descriptor_sha256:digest(fs.readFileSync(process.env.CUSTODIAL_CURRENT310_OWNED_CI_DESCRIPTOR)),target:{cid:descriptor.cid,owner:descriptor.owner,name:descriptor.name,runtime:descriptor.runtime,workspace:descriptor.workspace},source,fingerprint:before.fingerprint,normalized:before.normalized,production:false,release_admission:false,historical_canonical_equivalence:false};
 const invariantBytes=Buffer.from(JSON.stringify(invariant,null,2)+'\n');fs.writeFileSync(invariantPath,invariantBytes,{flag:'wx',mode:0o600});
 const script=path.join(root,report.transformation.counterpart.path);
 report.original_test_sha256=report.transformation.original.sha256;report.counterpart_test_sha256=createHash('sha256').update(fs.readFileSync(script)).digest('hex');
 const fd=fs.openSync(path.join(output,'CURRENT310_FINAL_UNCERTAINTY_COUNTERPART.log'),'wx',0o600);
 try {execFileSync(process.execPath,[script],{cwd:root,env:{...process.env,FINAL_UNCERTAINTY_TEST_DOCKER_CONTAINER:fixture.name,FINAL_UNCERTAINTY_TEST_DATABASE:'postgres',CUSTODIAL_CURRENT310_CATALOG_INVARIANT:invariantPath,CUSTODIAL_CURRENT310_CATALOG_INVARIANT_SHA256:digest(invariantBytes)},stdio:['ignore',fd,fd],timeout:180000});}
 finally {fs.closeSync(fd);}
 report.current310_counterpart_exit=0;
 report.canonical_checks=[1,2].map(n=>JSON.parse(fs.readFileSync(path.join(output,'CURRENT_CATALOG_CHECK_0'+n+'.json'),'utf8')));
 assert.equal(report.canonical_checks[0].status,'REFUSED_CATALOG_DIFFERENCE');assert.equal(report.canonical_checks[0].source_verified,true);assert.equal(report.canonical_checks[0].target_verified,true);
 assert.ok(report.canonical_checks[0].changed_sections.some(x=>['privilege_bearing_roles','role_memberships'].includes(x)));
 assert.equal(report.canonical_checks[0].synthetic_authority_roles.length,1);assert.ok(report.canonical_checks[0].synthetic_authority_roles.every(x=>x.rolcanlogin&&x.rolbypassrls&&x.service_role_member));
 assert.equal(report.canonical_checks[1].status,'PASS_CURRENT310_CATALOG_EQUAL');assert.deepEqual(report.canonical_checks[1].synthetic_authority_roles,[]);
 const after=await capture();assert.deepEqual(after.normalized,before.normalized);report.after_fingerprint=after.fingerprint;
 assert.equal((await pool.query("select tgenabled from pg_trigger where tgrelid='public.custodial_release_authority_restore_inventory'::regclass and tgname='trg_custodial_release_authority_restore_inventory_immutable'")).rows[0].tgenabled,'A');
 report.current_catalog_unchanged=true;report.passed=true;
} catch(error) {report.error={name:error.name,code:error.code??null,message:error.message};}
finally {
 if(pool)await pool.end();
 if(fixture)try{await fixture.cleanup();report.borrow_released=true;}catch(error){report.borrow_released=false;report.passed=false;report.cleanup_error=error.message;}
 report.parent_final_cleanup_required=true;
 if(output)fs.writeFileSync(path.join(output,'RESULT.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
}
