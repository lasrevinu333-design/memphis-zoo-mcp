import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,renameSync,rmSync,copyFileSync,chmodSync,symlinkSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {materializeVerifiedArchive,readVerifiedMigrationTargetCaptureSource} from './disaster-recovery-archive.mjs';
import {archiveSignatureBinding,signBinding} from './disaster-recovery-crypto.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
function signedFixture(){
 const root=mkdtempSync(join(tmpdir(),'UNIT-immutable-source-cache-'));mkdirSync(join(root,'inventory'));
 const key='UNIT-only-cache-signing-key-20261111-not-real',keyId='UNIT-cache';
 const members={'inventory/source-schema-binding.json':'{"version":"UNIT","nested":{"x":1}}\n','inventory/source-catalog.json':'{"functions":[],"nested":{"x":2}}\n','inventory/migration-ledger.json':'[{"version":"UNIT"}]\n','inventory/application-schema.sql':'-- UNIT source only\n'};
 const identity={backup_tool_commit:'a'.repeat(40),backup_tool_tree:'b'.repeat(40),source_schema_binding_sha256:sha(members['inventory/source-schema-binding.json']),source_catalog_sha256:sha(members['inventory/source-catalog.json']),migration_ledger_sha256:sha(members['inventory/migration-ledger.json'])};
 const summary={ok:true,format:'memphis-zoo-disaster-recovery.v4',consistent_database_snapshot:true,project_ref:'abcdefghijklmnopqrst',source_identity:identity};
 members['backup-summary.json']=JSON.stringify(summary)+'\n';for(const [path,bytes] of Object.entries(members))writeFileSync(join(root,path),bytes);
 const sums=Object.entries(members).map(([path,bytes])=>sha(bytes)+'  '+path).join('\n')+'\n';writeFileSync(join(root,'SHA256SUMS'),sums);
 const digest=sha(sums);writeFileSync(join(root,'archive-signature.json'),JSON.stringify({format:'memphis-zoo-disaster-recovery-signature.v1',algorithm:'hmac-sha256',key_id:keyId,archive_digest:digest,signature:signBinding(archiveSignatureBinding({archiveDigest:digest,projectRef:summary.project_ref,sourceIdentity:identity,archiveFormat:summary.format}),key)}));
 try{const archive=materializeVerifiedArchive({sourceDir:root,archiveVerifyKey:key,archiveVerifyKeyId:keyId});return {archive,cleanup(){archive.cleanup();rmSync(root,{recursive:true});}};}catch(e){rmSync(root,{recursive:true});throw e;}
}
test('authenticated immutable catalog cache returns frozen DATA and revalidates every hit',()=>{
 const f=signedFixture();try{const first=readVerifiedMigrationTargetCaptureSource(f.archive),second=readVerifiedMigrationTargetCaptureSource(f.archive);assert.equal(first,second);assert.ok(Object.isFrozen(first.catalog.nested));assert.throws(()=>first.catalog.nested.x=99);assert.throws(()=>first.ledger.push({}));}finally{f.cleanup();}
});
test('cache hits reject changed bytes, same-byte rewrites and inode replacements for every signed member',()=>{
 for(const name of ['source-schema-binding.json','source-catalog.json','migration-ledger.json'])for(const mutation of ['bytes','same','replace','symlink']){
  const f=signedFixture();try{readVerifiedMigrationTargetCaptureSource(f.archive);const path=join(f.archive.directory,'inventory',name),bytes=readFileSync(path);
   // Deliberately tamper only our freshly-created UNIT snapshot, never a user archive.
   chmodSync(dirname(path),0o700);chmodSync(path,0o600);
   if(mutation==='replace'){writeFileSync(path+'.replacement',bytes);renameSync(path+'.replacement',path);}else if(mutation==='symlink'){writeFileSync(path+'.replacement',bytes);unlinkSync(path);symlinkSync(path+'.replacement',path);}else writeFileSync(path,mutation==='same'?bytes:Buffer.concat([bytes,Buffer.from(' ')]));
   assert.throws(()=>readVerifiedMigrationTargetCaptureSource(f.archive),name+' '+mutation);
  }finally{f.cleanup();}
 }
});
test('cache cannot survive archive withdrawal or accept a caller clone',()=>{
 const f=signedFixture();try{readVerifiedMigrationTargetCaptureSource(f.archive);assert.throws(()=>readVerifiedMigrationTargetCaptureSource({...f.archive}));f.archive.cleanup();assert.throws(()=>readVerifiedMigrationTargetCaptureSource(f.archive));}finally{f.cleanup();}
});
test('fixed program snapshot rejects same-byte replacement and changed Source after load',async()=>{
 const moduleSource=readFileSync('scripts/immutable-private-postgres-source.mjs','utf8');
 for(const mutation of ['same','replace','bytes']){
  const root=mkdtempSync(join(tmpdir(),'UNIT-program-cache-'));
  try{
   const bundle=join(root,'program.json'),provenance=join(root,'installed.sql');copyFileSync('proposals/immutable-private-current-postgres-program.json',bundle);copyFileSync('release/installed-source/20261031225210_custodial_sealed_repairs_current_eight.sql',provenance);
   const module=moduleSource.replace("fileURLToPath(new URL('../proposals/immutable-private-current-postgres-program.json',import.meta.url))",JSON.stringify(bundle)).replace("fileURLToPath(new URL('../release/installed-source/20261031225210_custodial_sealed_repairs_current_eight.sql',import.meta.url))",JSON.stringify(provenance));
   const path=join(root,'reader.mjs');writeFileSync(path,module);const {loadImmutableCurrentPostgresSource}=await import(pathToFileURL(path));const source=loadImmutableCurrentPostgresSource();source.assertCurrent();
   const bytes=readFileSync(bundle);if(mutation==='replace'){writeFileSync(bundle+'.replacement',bytes);renameSync(bundle+'.replacement',bundle);}else writeFileSync(bundle,mutation==='same'?bytes:Buffer.from(bytes.toString().replace('postgres','postgrex')));
   assert.throws(()=>source.assertCurrent());
  }finally{rmSync(root,{recursive:true});}
 }
});

test('cached DATA cannot outlive changed signed control binding',()=>{
 for(const name of ['backup-summary.json','archive-signature.json']){
  const f=signedFixture();try{readVerifiedMigrationTargetCaptureSource(f.archive);
   const path=join(f.archive.directory,name);chmodSync(path,0o600);
   writeFileSync(path,Buffer.concat([readFileSync(path),Buffer.from(' ')]));
   assert.throws(()=>readVerifiedMigrationTargetCaptureSource(f.archive));
  }finally{f.cleanup();}
 }
});
