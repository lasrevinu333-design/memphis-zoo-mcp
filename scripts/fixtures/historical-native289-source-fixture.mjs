// Retained source proof only. No database constructor, runtime profile or
// production reader accepts this helper as an admission capability.
import {restoreReminderHistoricalSource} from './reminder-timing-source-successor.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,readdirSync} from 'node:fs';
import {resolve,relative,dirname,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {verifyCurrentMigrationSourceInventory} from './current-migration-source-fixtures.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=readFileSync(new URL('./historical-native289-source.json',import.meta.url));
assert.equal(bytes.length,148755);assert.equal(sha(bytes),'4cbc879ccd048c1e1d6db0b7b8478ba658016aec60c475ca9b4f5fa1deb78abd');
const document=JSON.parse(bytes);assert.equal(document.schema,'custodial.historical-native289-source-fixture.v1');
assert.equal(document.historical_members,289);assert.equal(document.current_source_inventory,315);assert.equal(document.current_canonical_members,311);
assert.equal(document.catalog_context,'CURRENT311_EXISTING_PREPARE_MEMBER_ONLY_NOT289_CATALOG; full current bytes, only the historical owning function and grants are compared');
assert.equal(document.SQL_executed,false);assert.equal(document.runtime_admission,false);
assert.equal(new Set(document.entries.map(x=>x.path)).size,326);assert.equal(document.static_import_closure.length,15);
function read(root,path,size,digest){
 const file=resolve(root,path),rel=relative(root,file);assert.ok(rel&&!rel.startsWith('..'+sep)&&!rel.startsWith(sep));
 for(let at=file;at!==root;at=dirname(at))assert.equal(lstatSync(at).isSymbolicLink(),false);
 const st=lstatSync(file);assert.ok(st.isFile());const value=Buffer.from(restoreReminderHistoricalSource(path,readFileSync(file,'utf8')));
 assert.equal(value.length,size);assert.equal(sha(value),digest,path);return value;
}
export async function withHistoricalNative289SourceFixture(root,run){
 root=resolve(root);assert.equal(realpathSync(root),root);assert.equal(typeof run,'function');
 verifyCurrentMigrationSourceInventory(root);
 const owned=mkdtempSync(resolve(tmpdir(),'custodial-retained-native289-')),identity=lstatSync(owned);
 assert.equal(identity.uid,process.getuid());assert.equal(realpathSync(owned),owned);
 try{
  for(const row of document.entries){
   read(root,row.path,row.current_bytes,row.current_sha256);
   const selected=read(root,row.selected_path,row.selected_bytes,row.selected_sha256);
   const file=resolve(owned,row.path);mkdirSync(dirname(file),{recursive:true,mode:0o700});writeFileSync(file,selected,{flag:'wx',mode:0o600});
  }
  assert.equal(readdirSync(resolve(owned,'supabase/migrations')).filter(n=>n.endsWith('.sql')).length,289);
  const value=await run(owned);
  for(const row of document.entries){read(root,row.path,row.current_bytes,row.current_sha256);read(root,row.selected_path,row.selected_bytes,row.selected_sha256);}
  verifyCurrentMigrationSourceInventory(root);return value;
 }finally{
  const st=lstatSync(owned);assert.ok(st.isDirectory()&&!st.isSymbolicLink());assert.equal(st.dev,identity.dev);assert.equal(st.ino,identity.ino);assert.equal(st.uid,identity.uid);assert.equal(realpathSync(owned),owned);rmSync(owned,{recursive:true});
 }
}
