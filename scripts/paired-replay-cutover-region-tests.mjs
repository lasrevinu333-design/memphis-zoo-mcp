// Executes the actual production-checker region only, with unsigned synthetic
// tree descriptors and real source bytes. Never runs the signing/DB/apply gate.
import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';import {createHash} from 'node:crypto';import vm from 'node:vm';
const sha=b=>createHash('sha256').update(b).digest('hex'),json=p=>JSON.parse(readFileSync(p,'utf8'));
const prior=json('scripts/fixtures/prior-cutover-replay-region.json');
assert.equal(prior.source_commit,'3534bd60178c0302ce2e466e66b8ba27652cfef0');assert.equal(prior.whole_source_sha256,'ab4472aadfc45e4e9a9edc382243682f8fd84767ab220a4449773030a5b557fd');assert.equal(prior.region_sha256,'ec96e2d014464828e65e7701025c3460d9f41f9b3d9bc8ef3f45ac72b9f4b72b');assert.equal(sha(prior.code),prior.region_sha256);
const whole=readFileSync('scripts/integrated-backend-authority-cutover-check.mjs','utf8'),a=whole.indexOf('// Ordering is an immutable signed-source declaration'),b=whole.indexOf('const releaseEvidence =',a);assert.ok(a>=0&&b>a);const code=whole.slice(a,b);
const replay=json('supabase/canonical/migration-replay-order.json'),state=json('release/production-migration-state.json');
const files=readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')).sort().map(n=>({path:'supabase/migrations/'+n,bytes:readFileSync('supabase/migrations/'+n)}));
function fixture(){return{replay:structuredClone(replay),state:structuredClone(state),expectedCount:252,files:files.map(x=>({...x,bytes:Buffer.from(x.bytes)}))};}
function run(region,f){const bytes=Buffer.from(JSON.stringify(f.replay,null,2)+'\n'),blobs=[...f.files,{path:'supabase/canonical/migration-replay-order.json',bytes}];
 const context=vm.createContext({assert,hash:sha,Buffer});
 // All data/array prototypes belong to the same VM as the real region. Avoid
 // introducing a cross-realm deepStrictEqual failure absent from production.
 const serialized=JSON.stringify({state:f.state,count:f.expectedCount,blobs:blobs.map(x=>({path:x.path,base64:x.bytes.toString('base64')}))});
 new vm.Script('const fixture=JSON.parse('+JSON.stringify(serialized)+'); const productionMigrationState=fixture.state; const expectedMigrationCount=fixture.count; const expectedBlobs=fixture.blobs.map(x=>({path:x.path,bytes:Buffer.from(x.base64,"base64")})); const blobByPath=new Map(expectedBlobs.map(x=>[x.path,x])); function parseJsonBlob(blob){return JSON.parse(blob.bytes.toString("utf8"));}').runInContext(context,{timeout:1000});
 new vm.Script(region,{filename:'actual-cutover-replay-source-region'}).runInContext(context,{timeout:1000});
 return new vm.Script('({applied:appliedReleaseMigrations.length,pending:pendingReleaseMigrations.length})').runInContext(context);}
let checks=0;
assert.throws(()=>run(prior.code,fixture()),e=>e.actual==='custodial.migration-replay-order.v2'&&e.expected==='custodial.migration-replay-order.v1');checks++;
const accepted=run(code,fixture());assert.equal(accepted.applied,134);assert.equal(accepted.pending,118);checks+=2;
const attacks=[
 ['unknown profile',f=>f.replay.schema='custodial.migration-replay-order.v3'],
 ['source grants production approval',f=>f.replay.production_execution_authorized=true],
 ['wrong verified prefix',f=>f.replay.base_source_commit='a'.repeat(40)],
 ['wrong integration predecessor',f=>f.replay.integration_base_source_commit='a'.repeat(40)],
 ['missing whole alert phase',f=>f.replay.phases.pop()],
 ['unknown phase',f=>f.replay.phases[2].kind='unreviewed'],
 ['omitted paired member',f=>f.replay.phases[2].files.pop()],
 ['reordered paired members',f=>f.replay.phases[2].files.reverse()],
 ['altered paired bytes and declaration',f=>{const x=f.replay.phases[2].files[0],blob=f.files.find(b=>b.path.endsWith('/'+x.name));blob.bytes=Buffer.concat([blob.bytes,Buffer.from('\n')]);x.sha256=sha(blob.bytes);}],
 ['altered lunch bytes and declaration',f=>{const x=f.replay.phases[2].files.at(-1),blob=f.files.find(b=>b.path.endsWith('/'+x.name));blob.bytes=Buffer.concat([blob.bytes,Buffer.from('\n')]);x.sha256=sha(blob.bytes);}],
 ['lost lunch tail only',f=>{const x=f.replay.phases[2].files.pop();f.files=f.files.filter(b=>!b.path.endsWith('/'+x.name));f.expectedCount--;f.state.pending_migrations.pop();f.state.source_binding.source_replay_manifest_sha256=sha(JSON.stringify(f.replay,null,2)+'\n');}],
 ['duplicate version in another phase',f=>{const x=f.replay.phases[1].files[0];x.name='00000000000000_duplicate.sql';}],
 ['missing signed migration member',f=>f.files.pop()],
 ['altered source SQL without declaration',f=>f.files[0].bytes=Buffer.from('select 1;')],
 ['extra SQL in complete source tree',f=>f.files.push({path:'supabase/migrations/20261007000000_unexpected.sql',bytes:Buffer.from('select 1;')})],
 ['wrong whole inventory count',f=>f.expectedCount=253],
 ['lost pending metadata',f=>f.state.pending_migrations.pop()],
 ['reordered pending metadata',f=>f.state.pending_migrations.reverse()],
 ['wrong prefix identity metadata',f=>f.state.source_binding.source_prefix_commit='b'.repeat(40)],
 ['wrong entire manifest digest',f=>f.state.source_binding.source_replay_manifest_sha256='c'.repeat(64)],
 ['different observed prefix head',f=>f.state.observed_production.ledger_head='20261006203930'],
];
for(const [label,mutate]of attacks){const f=fixture();mutate(f);assert.throws(()=>run(code,f),undefined,label);checks++;}
const old=fixture();old.replay.schema='custodial.migration-replay-order.v1';old.replay.phases.pop();delete old.replay.integration_base_source_commit;old.state.pending_migrations=old.state.pending_migrations.slice(0,93);old.state.source_binding.source_replay_manifest_sha256=sha(JSON.stringify(old.replay,null,2)+'\n');old.files=old.files.filter(x=>!replay.phases[2].files.some(r=>x.path.endsWith('/'+r.name)));old.expectedCount=227;
assert.equal(run(prior.code,old).pending,93);assert.equal(run(code,old).pending,93);checks+=2;
console.log(JSON.stringify({status:'PAIRED_REPLAY_CUTOVER_REGION_PASS',checks,prefix:134,pending:118,source:252,old_227_supported:true,actual_checker_region_sha256:sha(code),baseline_region_sha256:prior.region_sha256,unsigned:true,full_signed_gate:false,sql:false,production:false}));
