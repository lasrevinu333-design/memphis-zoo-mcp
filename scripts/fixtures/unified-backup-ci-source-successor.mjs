import {beforeCurrent429CommitReceipts} from './current429-commit-receipt-workflow.mjs';
// Local integrated-source bookkeeping only. No SQL, runtime, release or device admission.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const raw=readFileSync(new URL('./unified-backup-ci-source-successor.json',import.meta.url));
assert.equal(sha(raw),'4f5bcc602c8657ee9d46150fc708a1091b6ca3a4ca5437681ea4ffbe6844ec0a');
const doc=JSON.parse(raw);
assert.equal(doc.historical_pins_rewritten,false);assert.equal(doc.SQL_executed,false);assert.equal(doc.release_admission,false);
const successors=readFileSync(new URL('./unified-backup-rehearsal-successors.json',import.meta.url));
assert.equal(sha(successors),'35cd33c8db075fa8c52a955dab31ebf22d670eead1cc8d1b8803de411dddce7c');
const revisions=JSON.parse(successors);
export function historicalInput(path,source){
 if(path==='.github/workflows/production-backup-migration-rehearsal.yml')source=beforeCurrent429CommitReceipts(source);
 const revision=revisions[path];
 if(!revision || sha(source)!==revision.sha256)return source;
 const lines=source.match(/[^\n]*\n|[^\n]+$/g);
 for(const edit of [...revision.edits].reverse())lines.splice(edit.at,edit.remove,...edit.restore);
 const prior=lines.join('');assert.equal(sha(prior),revision.historical_sha256);
 return prior;
}
export function restoreUnifiedBackupPackage(bytes){
 const text=bytes.toString(),known=historicalInput('package.json',text);
 if(known!==text)bytes=Buffer.from(known);
 if(sha(bytes)!==doc.package.current_sha256)return bytes;
 const value=JSON.parse(bytes);for(const [name,command]of Object.entries(doc.package.added_scripts)){
  assert.equal(value.scripts[name],command);delete value.scripts[name];
 }
 const prior=Buffer.from(JSON.stringify(value,null,2)+'\n');assert.equal(sha(prior),doc.package.prior_sha256);return prior;
}
export function restoreUnifiedBackupWorkflow(source,name){
 source=historicalInput('.github/workflows/'+name,source);
 const row=doc.workflows.find(x=>x.name===name);if(!row||sha(source)!==row.current_sha256)return source;
 for(const hunk of row.hunks){assert.equal(source.split(hunk.current).length,2);source=source.replace(hunk.current,()=>hunk.prior);}
 assert.equal(sha(source),row.prior_sha256);return source;
}
export function verifyUnifiedBackupCiInputs(root){
 const packageBytes=readFileSync(new URL('package.json',root));assert.equal(sha(historicalInput('package.json',packageBytes.toString())),doc.package.current_sha256);
 assert.equal(sha(restoreUnifiedBackupPackage(packageBytes)),doc.package.prior_sha256);
 for(const row of doc.workflows){const source=readFileSync(new URL('.github/workflows/'+row.name,root),'utf8');
  assert.equal(sha(historicalInput('.github/workflows/'+row.name,source)),row.current_sha256);assert.equal(sha(restoreUnifiedBackupWorkflow(source,row.name)),row.prior_sha256);}
 return Object.freeze({status:'PASS_EXACT_INTEGRATED_SOURCE_LINEAGE_ONLY',added_scripts:9,workflows:doc.workflows.length,historical_pins_rewritten:false,SQL_executed:false,release_admission:false});
}

export function restoreUnifiedQualifiedSource(path,source){
 const row=doc.qualified_sources.find(x=>x.path===path);if(!row||sha(source)!==row.current_sha256)return source;
 for(const hunk of row.hunks){assert.equal(source.split(hunk.current).length,2);source=source.replace(hunk.current,()=>hunk.prior);}
 assert.equal(sha(source),row.prior_sha256);return source;
}

// Execution checks use today's declared package inputs. The surrounding job
// layout is still projected to its independently verified historical shape.
export function currentUnifiedPackageRegressionView(source){
 const path='.github/workflows/foundation-security-gate.yml';
 const current=readFileSync(new URL('../../'+path,import.meta.url),'utf8');
 const approved=doc.workflows.find(row=>row.name==='foundation-security-gate.yml');
 assert.equal(sha(historicalInput(path,current)),approved.current_sha256);
 const pins=/^          [a-f0-9]{64}  package(?:-lock)?\.json$/gm;
 const declared=current.match(pins),historical=source.match(pins);
 assert.equal(declared?.length,2);assert.equal(historical?.length,2);
 for(const [i,name] of ['package.json','package-lock.json'].entries()){
  assert.ok(declared[i].endsWith('  '+name)&&historical[i].endsWith('  '+name));
  source=source.replace(historical[i],declared[i]);
 }
 return source;
}
