// Connected current310 catalog check for the two explicitly transformed calls.
// Parent captures the fresh schema; this checker never refreshes canonical files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import {OwnedDockerPgStream,requireOwnedDatabase} from './current-candidate-owned-pg-stream.mjs';
import {captureSchemaCatalog,fingerprintSchemaCatalog} from './schema-fingerprint-catalog.mjs';
import {currentQualificationSource,qualificationRoot,digest} from './current-qualified-catalog-invariant.mjs';
const report={schema:'custodial.current310-catalog-check.v1',status:'REFUSED_UNVERIFIED_CONTEXT',production:false,release_admission:false,historical_canonical_equivalence:false};
let pool,output,sequence;
try {
 assert.deepEqual(process.argv.slice(2),['--check']);
 const exactPrivateFile=file=>{assert.ok(path.isAbsolute(file||''));const s=fs.lstatSync(file);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&0o777)===0o600);assert.equal(fs.realpathSync(file),file);return fs.readFileSync(file);};
 const descriptorPath=process.env.CUSTODIAL_CURRENT310_OWNED_CI_DESCRIPTOR;
 const descriptorBytes=exactPrivateFile(descriptorPath),d=JSON.parse(descriptorBytes);
 assert.equal(d.schema,'custodial.current310-owned-ci-database.v1');assert.equal(d.production,false);assert.equal(d.release_admission,false);
 assert.equal(d.consumer,path.join(qualificationRoot,'scripts/current-qualified-final-closure-tests.mjs'));assert.deepEqual(d.consumer_args,[]);
 assert.equal(process.env.SCHEMA_FINGERPRINT_DOCKER_CONTAINER,d.name);assert.equal(process.env.SCHEMA_FINGERPRINT_DATABASE,'postgres');
 assert.equal(process.env.FINAL_UNCERTAINTY_TEST_DOCKER_CONTAINER,d.name);assert.equal(process.env.FINAL_UNCERTAINTY_TEST_DATABASE,'postgres');
 assert.equal(fs.realpathSync(d.runtime),d.runtime);assert.equal(fs.realpathSync(d.workspace),d.workspace);assert.equal(path.dirname(d.workspace),d.runtime);
 const expectedPath=process.env.CUSTODIAL_CURRENT310_CATALOG_INVARIANT;
 output=path.join(d.runtime,'ci-output','current310-final-closure-'+d.owner);assert.equal(path.dirname(expectedPath),output);assert.equal(path.basename(expectedPath),'CURRENT310_CATALOG_INVARIANT.json');assert.equal(fs.realpathSync(output),output);
 const expectedBytes=exactPrivateFile(expectedPath);assert.equal(digest(expectedBytes),process.env.CUSTODIAL_CURRENT310_CATALOG_INVARIANT_SHA256);
 const expected=JSON.parse(expectedBytes);assert.equal(expected.schema,'custodial.current310-fresh-catalog-invariant.v1');assert.equal(expected.descriptor_sha256,digest(descriptorBytes));
 assert.deepEqual(expected.target,{cid:d.cid,owner:d.owner,name:d.name,runtime:d.runtime,workspace:d.workspace});
 const source=currentQualificationSource();assert.deepEqual(expected.source,source);assert.deepEqual(d.profile,source.profile);
 assert.equal(d.source_profile_sha256,digest(fs.readFileSync(path.join(qualificationRoot,'scripts/current-qualified-replay-profile.mjs'))));
 assert.equal(d.relay.kind,'static');assert.equal(d.relay.path,'/docker-entrypoint-initdb.d/custodial-pg-wire-relay');assert.equal(d.relay.host_path,path.join(d.workspace,'init/custodial-pg-wire-relay'));assert.equal(digest(fs.readFileSync(d.relay.host_path)),d.relay.sha256);
 const verify=()=>{assert.deepEqual(fs.readFileSync(descriptorPath),descriptorBytes);assert.deepEqual(fs.readFileSync(expectedPath),expectedBytes);assert.deepEqual(currentQualificationSource(),source);const actual=requireOwnedDatabase(d.cid,d.owner,d.runtime);assert.equal(actual.Name,'/'+d.name);assert.ok(actual.Mounts.some(m=>m.Destination==='/var/lib/postgresql/data'&&m.Source===path.join(d.workspace,'pgdata')&&m.RW));assert.ok(actual.Mounts.some(m=>m.Destination==='/docker-entrypoint-initdb.d'&&m.Source===path.join(d.workspace,'init')&&!m.RW));};
 verify();
 const existing=fs.readdirSync(output).filter(x=>/^CURRENT_CATALOG_CHECK_0[12]\.json$/.test(x)).sort();sequence=existing.length+1;assert.ok(sequence===1||sequence===2);if(sequence===2)assert.equal(existing[0],'CURRENT_CATALOG_CHECK_01.json');
 pool=new pg.Pool({host:'owned-current310-catalog-stream',ssl:false,stream:()=>{verify();return new OwnedDockerPgStream({cid:d.cid,owner:d.owner,runtime:d.runtime,relay:d.relay});},database:'postgres',user:'supabase_admin',max:1,connectionTimeoutMillis:5000});pool.on('error',()=>{});
 const client=await pool.connect();let actual;
 try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const catalog=await captureSchemaCatalog({query:async sql=>{const r=await client.query(sql);return {rows:r.rows.map(row=>{if(!Object.hasOwn(row,'object_comment'))return row;const x={...row,comment:row.object_comment};delete x.object_comment;return x;})};}});
  actual=fingerprintSchemaCatalog(catalog);
  report.synthetic_authority_roles=(await client.query("SELECT rolname,rolcanlogin,rolbypassrls,pg_has_role(oid,'service_role','MEMBER') service_role_member FROM pg_roles WHERE rolname LIKE 'custodial_uncertainty_%' ORDER BY rolname")).rows;
  assert.equal((await client.query("SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.custodial_release_authority_restore_inventory'::regclass AND tgname='trg_custodial_release_authority_restore_inventory_immutable'")).rows[0].tgenabled,'A');
  assert.equal(Number((await client.query("SELECT count(*) FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE d.defaclnamespace IN(0,'public'::regnamespace) AND d.defaclobjtype IN('r','S') AND a.grantee IN(0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)")).rows[0].count),0);
  await client.query('ROLLBACK');report.read_only_snapshot_returned=true;
 }catch(error){try{await client.query('ROLLBACK');}catch{report.rollback_unknown=true;}throw error;}finally{client.release();}
 verify();report.expected_fingerprint=expected.fingerprint;report.actual_fingerprint=actual.fingerprint;
 report.changed_sections=Object.keys(expected.normalized).filter(k=>JSON.stringify(expected.normalized[k])!==JSON.stringify(actual.normalized[k]));
 report.source_verified=true;report.target_verified=true;
 if(actual.fingerprint!==expected.fingerprint||report.changed_sections.length){report.status='REFUSED_CATALOG_DIFFERENCE';throw Error('Actual current310 catalog differs from the original parent fresh capture');}
 assert.deepEqual(actual.normalized,expected.normalized);report.status='PASS_CURRENT310_CATALOG_EQUAL';
}catch(error){report.error={name:error.name,code:error.code??null,message:error.message};}
finally {
 if(pool)try{await pool.end();report.pool_closed=true;}catch{report.status='REFUSED_POOL_CLOSE';}
 if(output&&sequence)try{fs.writeFileSync(path.join(output,'CURRENT_CATALOG_CHECK_0'+sequence+'.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}catch{report.status='REFUSED_EVIDENCE_WRITE';}
 console.log(JSON.stringify(report));if(report.status!=='PASS_CURRENT310_CATALOG_EQUAL')process.exitCode=1;
}
