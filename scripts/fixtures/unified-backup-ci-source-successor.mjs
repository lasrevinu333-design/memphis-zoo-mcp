// Local integrated-source bookkeeping only. No SQL, runtime, release or device admission.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const raw=readFileSync(new URL('./unified-backup-ci-source-successor.json',import.meta.url));
assert.equal(sha(raw),'c64820ab269016dba9a54f5b360c27b5fe4bae03cdd9418c7a73cbe645520787');
const doc=JSON.parse(raw);
assert.equal(doc.historical_pins_rewritten,false);assert.equal(doc.SQL_executed,false);assert.equal(doc.release_admission,false);
export function restoreUnifiedBackupPackage(bytes){
 if(sha(bytes)!==doc.package.current_sha256)return bytes;
 const value=JSON.parse(bytes);for(const [name,command]of Object.entries(doc.package.added_scripts)){
  assert.equal(value.scripts[name],command);delete value.scripts[name];
 }
 const prior=Buffer.from(JSON.stringify(value,null,2)+'\n');assert.equal(sha(prior),doc.package.prior_sha256);return prior;
}
export function restoreUnifiedBackupWorkflow(source,name){
 const row=doc.workflows.find(x=>x.name===name);if(!row||sha(source)!==row.current_sha256)return source;
 for(const hunk of row.hunks){assert.equal(source.split(hunk.current).length,2);source=source.replace(hunk.current,()=>hunk.prior);}
 assert.equal(sha(source),row.prior_sha256);return source;
}
export function verifyUnifiedBackupCiInputs(root){
 const packageBytes=readFileSync(new URL('package.json',root));assert.equal(sha(packageBytes),doc.package.current_sha256);
 assert.equal(sha(restoreUnifiedBackupPackage(packageBytes)),doc.package.prior_sha256);
 for(const row of doc.workflows){const source=readFileSync(new URL('.github/workflows/'+row.name,root),'utf8');
  assert.equal(sha(source),row.current_sha256);assert.equal(sha(restoreUnifiedBackupWorkflow(source,row.name)),row.prior_sha256);}
 return Object.freeze({status:'PASS_EXACT_INTEGRATED_SOURCE_LINEAGE_ONLY',added_scripts:9,workflows:doc.workflows.length,historical_pins_rewritten:false,SQL_executed:false,release_admission:false});
}

export function restoreUnifiedQualifiedSource(path,source){
 const row=doc.qualified_sources.find(x=>x.path===path);if(!row||sha(source)!==row.current_sha256)return source;
 for(const hunk of row.hunks){assert.equal(source.split(hunk.current).length,2);source=source.replace(hunk.current,()=>hunk.prior);}
 assert.equal(sha(source),row.prior_sha256);return source;
}

// The original dedicated-step mutation oracle compares current file bytes.
// After its complete historical workflow view is proven, carry today's one
// package input digest into that test-only view; no other line is changed.
export function currentUnifiedPackageRegressionView(source){
 const from=doc.package.prior_sha256+'  package.json';assert.equal(source.split(from).length,2);
 return source.replace(from,doc.package.current_sha256+'  package.json');
}
