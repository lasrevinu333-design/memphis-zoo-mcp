import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolveReleaseMigrationSource,bindExistingPostgresForwardSources} from './production-forward-source.mjs';
import {CURRENT308_FILE,CURRENT308_SHA256,CURRENT308_FORWARD_SHA256,CURRENT308_PREDECESSORS} from './release-migration-current308-refusal.mjs';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),sha=s=>createHash('sha256').update(s).digest('hex');
const original=read('supabase/migrations/'+CURRENT308_FILE),forward=read('release/production-forward-source/'+CURRENT308_FILE),profile=JSON.parse(read('release/production-forward-source/current308-existing-profile.json'));
assert.equal(sha(original),CURRENT308_SHA256);assert.equal(sha(forward),CURRENT308_FORWARD_SHA256);
assert.equal(profile.evidence_run,41746616388);assert.equal(profile.rollback_verified,true);
assert.equal(profile.inventory.count,'7571');assert.equal(profile.api_defaults.length,44);
assert.ok(forward.includes("inventory_expected constant text:='"+profile.inventory.sha256+"'"));
assert.ok(forward.includes("canary_expected constant text:='"+profile.canary.function_sha256+"'"));
assert.deepEqual(JSON.parse(forward.split('$current308_defaults$')[1]),profile.api_defaults);
for(const field of ['owner_name','schema_name','object_type','grantee','grantor','privilege_type'])assert.ok(forward.includes(field+' COLLATE \"C\"'));
const tuples=sql=>sql.split('INSERT INTO q309_expected_mismatches VALUES\n')[1].split('\nDO $actual_mismatches$')[0];
assert.equal(tuples(forward),tuples(original));assert.equal(CURRENT308_PREDECESSORS.length,39);
// All mutation and verification logic after the precondition must be exact,
// except for the additional snapshot and preservation check of default ACLs.
let body=forward.slice(forward.indexOf('CREATE TEMP TABLE q309_expected_mismatches'));
body=body.replace('CREATE TEMP TABLE q309_original_defaults ON COMMIT DROP AS TABLE pg_default_acl;\n','');
body=body.replace(/DO \$preserve_default_acl\$[\s\S]*?END \$preserve_default_acl\$;\n/,'');
assert.equal(body,original.slice(original.indexOf('CREATE TEMP TABLE q309_expected_mismatches')));
assert.ok(forward.includes('SELECT * FROM q309_original_defaults EXCEPT SELECT * FROM pg_default_acl'));
assert.ok(forward.includes('SELECT * FROM pg_default_acl EXCEPT SELECT * FROM q309_original_defaults'));
assert.ok(!/alter\s+default\s+privileges/i.test(forward));
const baselineManifest=JSON.parse(read('release/production-forward-source/manifest.json'));
const entry=baselineManifest.migrations.find(x=>x.canonical_file===CURRENT308_FILE);
assert.equal(entry.forward_sha256,CURRENT308_FORWARD_SHA256);assert.equal(entry.canonical_sha256,CURRENT308_SHA256);
const root=fileURLToPath(new URL('..',import.meta.url));
const canonical={order:175,file:CURRENT308_FILE,source_migration_version:CURRENT308_FILE.slice(0,14),sha256:CURRENT308_SHA256};
const [bound]=bindExistingPostgresForwardSources(root,[canonical]);assert.equal(resolveReleaseMigrationSource(root,bound).sql,forward);
for(const mutate of [x=>delete x.forward_source,x=>x.forward_source.profile='supabase_admin',x=>x.forward_source.canonical_sha256='0'.repeat(64),x=>x.forward_source.file='../outside.sql',x=>x.sha256='0'.repeat(64),x=>x.forward_source.sha256='0'.repeat(64),x=>x.forward_source.extra='not-admitted']){
 const changed=structuredClone(bound);mutate(changed);assert.throws(()=>resolveReleaseMigrationSource(root,changed));
}
console.log(JSON.stringify({status:'PASS_SOURCE_ONLY',exact_original_repair_tuples:39,api_defaults_preserved:44,mutation_and_readback_logic_exact:true,SQL_executed:false,production:false}));
