// Explicit LOCAL current308 CI consumer. This does not admit any historical
// release/recovery profile, expose a host socket, change grants, or own cleanup
// of a parent's database. The bounded Python fixture owns final destruction.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {OwnedDockerPgStream,requireOwnedDatabase} from './current-candidate-owned-pg-stream.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function consumeCurrentCandidateSqlFixture(options){
 const file=process.env.CUSTODIAL_CURRENT308_OWNED_CI_DESCRIPTOR;
 assert.ok(path.isAbsolute(file||''),'Explicit owned current308 descriptor required');
 const stat=fs.lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o777)===0o600&&stat.size<1048576);
 assert.equal(fs.realpathSync(file),file);const raw=fs.readFileSync(file),d=JSON.parse(raw);
 assert.equal(d.schema,'custodial.current308-owned-ci-database.v1');assert.equal(d.release_admission,false);assert.equal(d.production,false);
 const actualConsumer=path.resolve(process.argv[1]);
 const admittedChild=path.basename(d.consumer)==='static-weekly-vacate-roster-slot-database-tests.mjs'
   &&['static-weekly-midweek-vacancy-database-fixture.mjs','static-weekly-vacate-roster-slot-fixture-tests.mjs'].includes(path.basename(actualConsumer))
   &&path.dirname(actualConsumer)===path.resolve(root,'scripts');
 assert.ok(actualConsumer===path.resolve(d.consumer)||admittedChild,'Only exact parent or its two existing SQL child fixtures may borrow this database');
 assert.deepEqual(process.argv.slice(2),admittedChild?[]:d.consumer_args);
 if(admittedChild)assert.ok(d.consumer_args.length===0||JSON.stringify(d.consumer_args)==='["--current-fixture-index","0"]'||JSON.stringify(d.consumer_args)==='["--current-fixture-index","1"]');
 assert.equal(path.dirname(d.consumer),path.resolve(root,'scripts'));
 assert.match(options?.name||'',/^mz_schema_rebuild_[a-zA-Z0-9_]+$/);
 assert.equal(d.no_API_table_sequence_defaults,true);assert.equal(d.source_profile_sha256,sha(fs.readFileSync(path.join(root,'scripts/current-candidate-replay-profile.mjs'))));
 const actualProfile=JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/current-candidate-replay-profile.mjs'),'--describe'],{encoding:'utf8',timeout:15000,maxBuffer:1048576}));
 assert.deepEqual(d.profile,actualProfile);assert.equal(actualProfile.migration_count,308);
 assert.equal(fs.realpathSync(d.runtime),d.runtime);assert.equal(fs.realpathSync(d.workspace),d.workspace);assert.equal(path.dirname(d.workspace),d.runtime);
 assert.equal(d.relay.kind,'static');assert.equal(d.relay.path,'/docker-entrypoint-initdb.d/custodial-pg-wire-relay');
 assert.equal(d.relay.host_path,path.join(d.workspace,'init/custodial-pg-wire-relay'));assert.equal(sha(fs.readFileSync(d.relay.host_path)),d.relay.sha256);
 let released=false;
 const verify=()=>{assert.deepEqual(fs.readFileSync(file),raw,'descriptor cannot change during borrowed fixture lifetime');const observed=requireOwnedDatabase(d.cid,d.owner,d.runtime);assert.equal(observed.Name,'/'+d.name);assert.ok(observed.Mounts.some(m=>m.Destination==='/var/lib/postgresql/data'&&m.Source===path.join(d.workspace,'pgdata')&&m.RW));assert.ok(observed.Mounts.some(m=>m.Destination==='/docker-entrypoint-initdb.d'&&m.Source===path.join(d.workspace,'init')&&!m.RW));return observed;};
 const noDefaults=()=>{verify();const sql="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclobjtype in ('r','S') and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole);";assert.equal(execFileSync('docker',['--host=unix:///var/run/docker.sock','exec','-i',d.cid,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{input:sql,encoding:'utf8',timeout:15000,maxBuffer:1048576}).trim(),'0');};
 verify();noDefaults();
 const config={host:'owned-current308-docker-stream',ssl:false,stream:()=>{assert.equal(released,false);verify();return new OwnedDockerPgStream({cid:d.cid,owner:d.owner,runtime:d.runtime,relay:d.relay});}};
 return {container:d.cid,name:d.name,socketDirectory:null,pgClientConfig:config,
  receipt:{schema:'custodial.current308-local-ci-borrow.v1',source_profile:actualProfile,descriptor_sha256:sha(raw),transport:'DOCKER_EXEC_AF_UNIX_NO_HOST_SOCKET',no_api_table_sequence_defaults:true,production:false,release_admission:false,parent_owns_final_cleanup:true,migration_witnesses:d.migration_witnesses},
  assertOwned:async()=>{assert.equal(released,false);verify();return true;},
  cleanup:async()=>{if(released)return;noDefaults();released=true;console.log('CURRENT308_LOCAL_SQL_CONSUMER_RELEASED_PARENT_FINAL_CLEANUP_STILL_REQUIRED');}};
}
