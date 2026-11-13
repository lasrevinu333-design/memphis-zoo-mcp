// Test-only filesystem views. Never a database constructor or release admission.
import {historicalMigrationNames,restoreReminderHistoricalSource} from './reminder-timing-source-successor.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,readdirSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {resolve,dirname,relative,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {reverseSource252ProductionRoleOrderOnly} from '../source252-production-role-order-proof.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=readFileSync(new URL('./current-migration-source-fixtures.json',import.meta.url));
assert.equal(bytes.length,137524);assert.equal(sha(bytes),'4826513541026d8404482d062ab2e3192ac5a25bde9412356922de855800e94d');
const document=JSON.parse(bytes);
assert.equal(document.schema,'custodial.exact-source-only-fixture-inventory.v1');
assert.equal(document.sql_execution,false);assert.equal(document.runtime_admission,false);
assert.equal(document.migrations.length,315);assert.equal(document.historical_names.length,304);assert.equal(document.current_names.length,311);
const paths=rows=>rows.map(r=>r.path);
assert.equal(new Set(paths(document.closure)).size,document.closure.length);
function read(root,row){
 assert.equal(root,resolve(root));const file=resolve(root,row.path),rel=relative(root,file);
 assert.ok(rel&&!rel.startsWith('..'+sep)&&!rel.startsWith(sep));
 for(let part=file;part!==root;part=dirname(part))assert.equal(lstatSync(part).isSymbolicLink(),false);
 const st=lstatSync(file);assert.ok(st.isFile());
 // Compare retained fixture bytes after reversing only the hash-bound source
 // successor; the current input verifier separately binds the repaired SQL.
 const value=Buffer.from(restoreReminderHistoricalSource(row.path,readFileSync(file,'utf8')));assert.equal(value.length,row.bytes);assert.equal(sha(value),row.sha256,'exact source fixture member: '+row.path);return value;
}
export function verifyCurrentMigrationSourceInventory(root){
 root=resolve(root);assert.equal(realpathSync(root),root);
 const names=readdirSync(resolve(root,'supabase/migrations')).filter(n=>n.endsWith('.sql')).sort();
 assert.deepEqual(historicalMigrationNames(root,names),document.migrations.map(r=>r.path.slice('supabase/migrations/'.length)));
 for(const row of [...document.migrations,...document.closure])read(root,row);
 const canonical=JSON.parse(read(root,document.closure.find(r=>r.path==='supabase/canonical/migration-replay-order.json')));
 assert.deepEqual(canonical.phases.map(p=>p.files.length),[134,93,84]);
 assert.deepEqual(canonical.phases.flatMap(p=>p.files.map(r=>r.name)),document.current_names);
 const migrations=new Map(document.migrations.map(r=>[r.path.slice('supabase/migrations/'.length),r]));
 for(const row of canonical.phases.flatMap(p=>p.files))assert.equal(row.sha256,migrations.get(row.name)?.sha256);
 assert.deepEqual(document.current_names.slice(0,304),document.historical_names);
 return Object.freeze({status:'PASS',source_files:315,canonical_members:311,historical_members:304,SQL_executed:false,runtime_admission:false});
}
export function historical304ForwardBytes(path,bytes){
 let value=Buffer.from(bytes);
// Historical304's target state predates exactly this measured ownership
// correction. Restore only its pinned SQL body and matching manifest member.
// Current311 always consumes the unchanged current forward source.
if(path==='release/production-forward-source/20261010193211_native_private_custody_chunk_retention.sql'){
 assert.equal(sha(value),'fffd25207dc1f7c1953bafe2dc23d4867c79724c4ed4f19995e36d3a71c95653');
 value=Buffer.from(reverseSource252ProductionRoleOrderOnly(value.toString('utf8')));
 assert.equal(sha(value),'4a961ebc7aefdfd99d04044fef0d7ceebc0f095783ff525491332244f329ce2a');
}
if(path==='release/production-forward-source/manifest.json'){
 assert.equal(sha(value),'2953e45aa0548b855342892243e626cdfe77ec89ad0985021f86b54973e8343b');
 const manifest=JSON.parse(value),item=manifest.migrations.find(x=>x.canonical_file==='20261010193211_native_private_custody_chunk_retention.sql');
 assert.equal(item.forward_sha256,'fffd25207dc1f7c1953bafe2dc23d4867c79724c4ed4f19995e36d3a71c95653');
 item.forward_sha256='4a961ebc7aefdfd99d04044fef0d7ceebc0f095783ff525491332244f329ce2a';value=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
 assert.equal(sha(value),'69decb91fbba6374765fac66ee68f7c6ad3293b6b5ff42e07cc9ac6823b3db23');
}
 return value;
}
export async function withCurrentMigrationSourceFixture(root,count,run){
 root=resolve(root);assert.ok([304,311].includes(count));assert.equal(typeof run,'function');
 verifyCurrentMigrationSourceInventory(root);
 const fixture=mkdtempSync(resolve(tmpdir(),'custodial-source-only-'+count+'-'));
 const identity=lstatSync(fixture);assert.equal(identity.uid,process.getuid());assert.equal(realpathSync(fixture),fixture);
 try{
  const selected=new Set(count===304?document.historical_names:document.current_names);
  const entries=[...document.closure,...document.migrations.filter(r=>selected.has(r.path.slice('supabase/migrations/'.length)))];
  for(const row of entries){
   const alias=count===304?document.historical_aliases[row.path]:null;
   const actual=alias?document.closure.find(r=>r.path===alias):row;assert.ok(actual);
   let value=read(root,actual);
   if(count===304)value=historical304ForwardBytes(row.path,value);
   const target=resolve(fixture,row.path);mkdirSync(dirname(target),{recursive:true,mode:0o700});writeFileSync(target,value,{flag:'wx',mode:0o600});
  }
  assert.equal(readdirSync(resolve(fixture,'supabase/migrations')).filter(n=>n.endsWith('.sql')).length,count);
  const result=await run(fixture);
  verifyCurrentMigrationSourceInventory(root);
  return result;
 }finally{
  const current=lstatSync(fixture);assert.ok(current.isDirectory()&&!current.isSymbolicLink());
  assert.equal(current.dev,identity.dev);assert.equal(current.ino,identity.ino);assert.equal(current.uid,identity.uid);
  assert.equal(realpathSync(fixture),fixture);rmSync(fixture,{recursive:true});
 }
}
