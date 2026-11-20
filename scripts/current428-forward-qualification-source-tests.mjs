import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as fs from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {assertCurrent428ForwardMetadata,qualificationTransactionBody,readVerifiedCurrent428ForwardQualificationSource} from './current428-forward-qualification-source.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const declaration=JSON.parse(readFileSync(new URL('../release/production-backup-source-extension-v2.native428.candidate.json',import.meta.url)));
// Explicit synthetic source descriptor using previously observed428 ledger
// metadata, not a signed archive. Never pass it to the original-owner reader.
const source=()=>({sourceBinding:{format:'memphis-zoo-disaster-recovery.v4',project_ref:declaration.project_ref,
 archive_digest:'241d1cd711d41708d00d3e61334275f0adde07d85d230d2c0d03fa9c5ff86da5',source_identity:{migration_ledger_count:428,migration_head:'20261115162648',migration_ledger_sha256:'7ee71df7d6e99fbe508721c7e4508fcd4a9f10c02a67f3769fa54d5b6a4077e7'}},
 binding:{schema:'custodial.backup-schema-extension.v2',captured_ledger_count:428,captured_migration_head:'20261115162648',ledger_sha256:declaration.ledger_sha256},
 ledger:structuredClone(declaration.ledger)});
test('detached observed428 metadata passes only the finite three-forward metadata preconditions',()=>assert.equal(assertCurrent428ForwardMetadata(source()),true));
for(const mutate of [s=>s.sourceBinding.archive_digest='a'.repeat(64),s=>s.sourceBinding.project_ref='a'.repeat(20),
 s=>s.sourceBinding.source_identity.migration_ledger_count=235,s=>s.sourceBinding.source_identity.migration_head='20261115162647',s=>s.sourceBinding.source_identity.migration_ledger_sha256='0'.repeat(64),
 s=>s.binding.schema='custodial.backup-schema-extension.v1',s=>s.binding.ledger_sha256='0'.repeat(64),s=>s.binding.captured_ledger_count=427,
 s=>s.ledger.pop(),s=>s.ledger[0].version=s.ledger[1].version,s=>s.ledger.at(-1).version='20261115162649',
 s=>s.ledger[0].version='20261115205201',s=>s.ledger[0].version='20261120002521',s=>s.ledger[0].version='20261120010931'])test('changed source boundary or already applied forward refuses',()=>{
 const s=source();mutate(s);assert.throws(()=>assertCurrent428ForwardMetadata(s));
});
test('detached metadata, copied descriptors and caller overrides cannot become a verified archive',()=>{
 for(const value of [source(),{},structuredClone(source().sourceBinding),null])assert.throws(()=>readVerifiedCurrent428ForwardQualificationSource(value));
 assert.throws(()=>readVerifiedCurrent428ForwardQualificationSource({},'override'));
});
test('exact current source files and historical235 target gate remain separately pinned',()=>{
 for(const [file,pin,bytes]of [
  ['20261115205201_accepted_seven_pattern_update_reuse_existing_capacity.sql','ebbf6b7ff9c2c11d711be7e222c3b27c176cd22993de2ae1cd295cd3991f35bd',1326046],
  ['20261120002521_messenger_direct_reopen_intents_v2.sql','61789ecdf60c55f953ab234dc6a61f42e83dc86e414e7373f2d8af9f8b3d0848',19878],
  ['20261120010931_messenger_direct_intent_cleanup.sql','1aed43cb28f280d7a42ac2764795c94b6cf8643954b9dfc2076f85b23283bee4',2836]]){
  const raw=readFileSync(new URL('../supabase/migrations/'+file,import.meta.url));assert.equal(raw.length,bytes);assert.equal(sha(raw),pin);
 }
 const historical=readFileSync(new URL('./release-migration-target-capture.mjs',import.meta.url));
 assert.equal(sha(historical),'3e06d8b3bd1f627da54b98cdb5dde236e7485868510b12cf4b0f0adfa90f43c1');
 assert.ok(historical.toString().includes('Signed archive must match the finite observed235 source declaration'));
});

test('the three exact forwards leave commit and rollback to the caller', () => {
 const load = name => readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');
 const schedule = load('20261115205201_accepted_seven_pattern_update_reuse_existing_capacity.sql');
 assert.equal(qualificationTransactionBody('20261115205201', schedule), schedule.split('\nBEGIN;')[1].split('\nCOMMIT;')[0] + '\n');
 const reopen = load('20261120002521_messenger_direct_reopen_intents_v2.sql');
 assert.equal(qualificationTransactionBody('20261120002521', reopen), reopen);
 const cleanup = load('20261120010931_messenger_direct_intent_cleanup.sql');
 assert.match(cleanup, /BEGIN; SET LOCAL statement_timeout.*COMMIT;/);
 assert.equal(qualificationTransactionBody('20261120010931', cleanup), cleanup,
  'Quoted SQL in the cleanup job must remain byte-for-byte exact');
});

test('unexpected top-level transaction commands and psql directives refuse', () => {
 for (const sql of [
  'BEGIN; SELECT 1;', 'SELECT 1; COMMIT;', 'BEGIN; COMMIT;',
  'BEGIN; SELECT 1; COMMIT; SELECT 2; COMMIT;',
  'BEGIN; START TRANSACTION; SELECT 1; COMMIT;',
  "BEGIN; PREPARE TRANSACTION 'unit'; COMMIT;",
  'BEGIN; ROLLBACK; SELECT 1; COMMIT;',
  'BEGIN; SAVEPOINT unit; SELECT 1; COMMIT;',
 ]) assert.throws(() => qualificationTransactionBody('20261115205201', sql));
 for (const sql of [
  'BEGIN; SELECT 1; COMMIT;', 'SELECT 1; END AND CHAIN;',
  '\\restrict unit\nSELECT 1;\n\\unrestrict unit\n',
 ]) assert.throws(() => qualificationTransactionBody('20261120010931', sql));
});

// Extract only the unchanged file-custody closure. Its URL is redirected to
// test-owned files; it never receives an archive/target or SQL execution port.
function fileCustodyUnit(unitImportUrl,ports={}){
 const source=readFileSync(new URL('./current428-forward-qualification-source.mjs',import.meta.url),'utf8');
 const a=source.indexOf('const identity=s=>'),z=source.indexOf('// Detached metadata checks',a);
 assert.ok(a>0&&z>a);const exact=source.slice(a,z);assert.equal(exact.split('import.meta.url').length,2);
 const code=exact.replace('import.meta.url','unitImportUrl');
 const dependencies={assert,sha,dirname,openSync:fs.openSync,closeSync:fs.closeSync,readFileSync:fs.readFileSync,
  lstatSync:fs.lstatSync,fstatSync:fs.fstatSync,constants:fs.constants,fileURLToPath,unitImportUrl,...ports};
 return new Function(...Object.keys(dependencies),code+'\nreturn sourceFile;')(...Object.values(dependencies));
}
function withCustodyFiles(run){
 const root=fs.mkdtempSync(join(tmpdir(),'custodial-current428-file-custody-'));
 const directory=join(root,'supabase','migrations');fs.mkdirSync(directory,{recursive:true});
 const path=join(directory,'synthetic.sql'),bytes=Buffer.from("SELECT 'unit only Ω';\n");fs.writeFileSync(path,bytes);
 const ref={file:'synthetic.sql',bytes:bytes.length,sha256:sha(bytes)};
 const url=pathToFileURL(join(root,'scripts','current428-forward-qualification-source.mjs')).href;
 try{return run({root,directory,path,bytes,ref,url});}finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('actual file-custody closure accepts exact singly linked bytes and closes its descriptor',()=>withCustodyFiles(({url,ref,bytes})=>{
 let closes=0;const unit=fileCustodyUnit(url,{closeSync(fd){closes++;return fs.closeSync(fd);}});
 const value=unit(ref);assert.equal(value.sql,bytes.toString('utf8'));assert.equal(closes,1);
 assert.equal(value.identity[5],1n);assert.equal(value.identity[6],BigInt(bytes.length));
}));
test('file-custody closure refuses missing, symlinked, hard-linked, truncated or changed bytes',()=>{
 for(const kind of ['missing','symlink','hardlink','truncated','same-size-changed','invalid-utf8'])withCustodyFiles(({root,path,ref,url,bytes})=>{
  let selected=ref;
  if(kind==='missing')fs.unlinkSync(path);
  if(kind==='symlink'){const other=join(root,'original.sql');fs.renameSync(path,other);fs.symlinkSync(other,path);}
  if(kind==='hardlink')fs.linkSync(path,join(root,'extra-link.sql'));
  if(kind==='truncated')fs.truncateSync(path,1);
  if(kind==='same-size-changed')fs.writeFileSync(path,Buffer.alloc(bytes.length,120));
  if(kind==='invalid-utf8'){const bad=Buffer.from([0xff,0xfe]);fs.writeFileSync(path,bad);selected={...ref,bytes:bad.length,sha256:sha(bad)};}
  assert.throws(()=>fileCustodyUnit(url)(selected),kind);
 });
});
test('file-custody closure refuses symlinked ancestors before opening a source file',()=>withCustodyFiles(({root,directory,ref,url})=>{
 const actual=join(root,'actual-migrations');fs.renameSync(directory,actual);fs.symlinkSync(actual,directory);
 let opened=0;assert.throws(()=>fileCustodyUnit(url,{openSync(...args){opened++;return fs.openSync(...args);}})(ref));assert.equal(opened,0);
}));
test('same read cannot adopt a changed file, replacement inode or changed ancestor permissions',()=>{
 for(const kind of ['file-edit','file-replacement','ancestor-mode'])withCustodyFiles(({root,path,ref,url,bytes})=>{
  let closes=0,read=false;
  const unit=fileCustodyUnit(url,{readFileSync(fd){const value=fs.readFileSync(fd);assert.equal(read,false);read=true;
   if(kind==='file-edit')fs.appendFileSync(path,'-- changed');
   if(kind==='file-replacement'){fs.renameSync(path,join(root,'old-source.sql'));fs.writeFileSync(path,bytes);}
   if(kind==='ancestor-mode'){const mode=fs.statSync(root).mode&0o777;fs.chmodSync(root,mode===0o700?0o750:0o700);}
   return value;
  },closeSync(fd){closes++;return fs.closeSync(fd);}});
  assert.throws(()=>unit(ref),kind);assert.equal(read,true);assert.equal(closes,1);
 });
});
